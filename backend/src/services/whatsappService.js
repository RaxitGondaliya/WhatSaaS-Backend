const axios = require('axios');
const conversationService = require('./conversationService');
const chatbotEngineService = require('../chatbotEngine/chatbotEngineService');
const businessService = require('./businessService');
const ChatSession = require('../models/ChatSession');

/**
 * Helper function to extract the first meaningful service/product selection from chatbot flow data.
 * It strictly ignores generic confirmation texts (YES, CONFIRM, DONE, etc).
 */
function extractRequestTitle(chatbotFlowData) {
    const genericConfirmations = new Set(['YES', 'NO', 'CONFIRM', 'SUBMIT', 'DONE', 'OK', 'CANCEL']);
    
    // 1. Prioritize chronologically tracked button selections from the engine
    if (chatbotFlowData.__button_selections && Array.isArray(chatbotFlowData.__button_selections)) {
        for (const selection of chatbotFlowData.__button_selections) {
            if (selection && !genericConfirmations.has(selection.toString().toUpperCase().trim())) {
                return selection.trim(); // First meaningful selection
            }
        }
    }
    
    // 2. Fallback: Search all session variables if __button_selections isn't available
    for (const [key, value] of Object.entries(chatbotFlowData || {})) {
        if (key.startsWith('__')) continue;
        if (value && !genericConfirmations.has(value.toString().toUpperCase().trim())) {
            // Assume it's a short selection string
            if (typeof value === 'string' && value.length < 50 && !value.includes('\n')) {
                return value.trim();
            }
        }
    }
    
    return null;
}

/**
 * Service to handle incoming WhatsApp webhook payloads and sending messages.
 */
class WhatsappService {
  /**
   * Process the incoming webhook payload from Meta
   * @param {Object} payload The entire webhook payload
   */
  async processIncomingMessage(payload) {
    try {
      if (
        payload.entry &&
        payload.entry[0].changes &&
        payload.entry[0].changes[0] &&
        payload.entry[0].changes[0].value.messages &&
        payload.entry[0].changes[0].value.messages[0]
      ) {
        const value = payload.entry[0].changes[0].value;
        const phone_number_id = value.metadata.phone_number_id;
        const message = value.messages[0];
        const from = message.from; // sender phone number
        const messageId = message.id; // Meta message ID
        
        const profileName = value.contacts && value.contacts[0] && value.contacts[0].profile ? value.contacts[0].profile.name : '';
        
        // 1. Multi-Tenant Lookup: Find the specific SaaS business by their WA Phone ID
        const businessData = await businessService.getBusinessByPhoneId(phone_number_id);
        if (!businessData) {
          console.warn(`\n[Warning] No SaaS client configured for phoneNumberId: ${phone_number_id}. Skipping processing.`);
          return;
        }

        const { business, whatsappConfig } = businessData;

        // 2. SaaS Chatbot Switch
        if (!whatsappConfig.chatbotEnabled) {
          console.log(`[Info] Chatbot is currently disabled for business: ${business.businessName}.`);
          return;
        }

        let msg_body = '';
        let triggerId = null;

        // Handle normal text messages
        if (message.type === 'text') {
          msg_body = message.text.body;
        } 
        // Handle interactive button clicks
        else if (message.type === 'interactive') {
          if (message.interactive.type === 'button_reply') {
            msg_body = message.interactive.button_reply.title || message.interactive.button_reply.id;
            triggerId = message.interactive.button_reply.id;
            console.log(`[DEBUG] Received Button ID: ${triggerId}`);
          } else if (message.interactive.type === 'list_reply') {
            msg_body = message.interactive.list_reply.title || message.interactive.list_reply.id;
            triggerId = message.interactive.list_reply.id;
            console.log(`[DEBUG] Received List ID: ${triggerId}`);
          }
        }

        if (msg_body) {
          console.log('\n--- Incoming WhatsApp Message ---');
          console.log(`From: ${from}`);
          console.log(`Message/Button: ${msg_body}`);
          console.log(`Message ID: ${messageId}`);
          console.log(`Business found: ${business.businessName}`);
          console.log('---------------------------------\n');

          try {
            // 3. Find or create conversation state
            const conversation = await conversationService.findOrCreateConversation(from);

            // Save incoming message
            await conversationService.saveMessage(
              conversation._id,
              from,
              msg_body,
              'incoming',
              messageId
            );

            // 3.5 Check for active ChatSession
            const SESSION_TIMEOUT = 30 * 60 * 1000;
            let chatSession = await ChatSession.findOne({ phoneNumber: from, businessId: business._id });
            if (chatSession) {
                const now = new Date();
                if (now - chatSession.updatedAt > SESSION_TIMEOUT) {
                    console.log(`[Session] Session expired for ${from}. Starting fresh.`);
                    await ChatSession.deleteOne({ _id: chatSession._id });
                    chatSession = null;
                }
            }

            // 4. Generate dynamic reply using the new Chatbot Engine
            console.log('Generating reply from DB...');
            const replyData = await chatbotEngineService.processMessage(msg_body, triggerId, business, conversation, chatSession, profileName);

            if (replyData && replyData.sessionAction) {
              const action = replyData.sessionAction;
              if (action.type === 'create') {
                 if (chatSession) await ChatSession.deleteOne({ _id: chatSession._id });
                 await ChatSession.create({
                   phoneNumber: from,
                   businessId: business._id,
                   currentFlowId: action.flowId,
                   currentNodeId: action.currentNodeId,
                   variables: action.variables || {},
                   waitingFor: action.waitingFor || '',
                   targetVariable: action.targetVariable || '',
                   stepCount: action.stepCount || 1
                 });
                 console.log(`[Session] Created new session for ${from}`);
              } else if (action.type === 'update' && chatSession) {
                 chatSession.currentNodeId = action.currentNodeId || chatSession.currentNodeId;
                 chatSession.variables = action.variables;
                 if (action.waitingFor !== undefined) chatSession.waitingFor = action.waitingFor;
                 if (action.targetVariable !== undefined) chatSession.targetVariable = action.targetVariable;
                 if (action.stepCount !== undefined) chatSession.stepCount = action.stepCount;
                 await chatSession.save();
                 console.log(`[Session] Updated session for ${from}`);
              } else if (action.type === 'delete' || action.type === 'cancel') {
                 if (chatSession) await ChatSession.deleteOne({ _id: chatSession._id });
                 console.log(`[Session] Deleted session for ${from} due to ${action.type}`);
               } else if (action.type === 'complete' && chatSession) {
                 const Request = require('../models/Request');
                 const Contact = require('../models/Contact');
                 
                 const vars = action.variables || {};

                 // 1. Contact Name: Always use WhatsApp profile name (flows don't collect name via text input)
                 const customerName = profileName || 'WhatsApp Customer';

                 // 2. Address/City: Look for any variable containing these keywords
                 let customerAddress = '';
                 let customerCity = '';
                 const addressKeys = [];
                 const cityKeys = [];

                 for (const key of Object.keys(vars)) {
                   if (key.startsWith('__')) continue;
                   const lk = key.toLowerCase();
                   if (lk.includes('address') || lk.includes('adress')) { customerAddress = vars[key]; addressKeys.push(key); }
                   if (lk.includes('city') || lk.includes('sehpar')) { customerCity = vars[key]; cityKeys.push(key); }
                 }

                 // 3. Upsert Contact
                 const contact = await Contact.findOneAndUpdate(
                     { phone: from, businessId: business._id },
                     {
                         $set: {
                             name: customerName,
                             ownerId: business.ownerId || business._id,
                             ...(customerAddress ? { address: customerAddress } : {}),
                             ...(customerCity ? { city: customerCity } : {})
                         }
                     },
                     { new: true, upsert: true, setDefaultsOnInsert: true }
                 );

                 // 4. Race Condition Safety
                 const recentRequest = await Request.findOne({
                     contactId: contact._id,
                     businessId: business._id,
                     source: "whatsapp",
                     createdAt: { $gte: new Date(Date.now() - 60 * 1000) }
                 });

                 if (recentRequest) {
                     console.log(`[Session] Preventing duplicate request creation for ${from} within 60s.`);
                 } else {
                     // 5. Title: First meaningful button selection (not YES/NO/CONFIRM)
                     const requestTitle = extractRequestTitle(vars) || 'WhatsApp Booking';

                     // 6. Description: All remaining variables, excluding address/city/title/confirmations
                     const titleValue = requestTitle;
                     const genericConfirmations = new Set(['YES', 'NO', 'CONFIRM', 'SUBMIT', 'DONE', 'OK', 'CANCEL']);
                     const excludedKeySet = new Set([...addressKeys, ...cityKeys]);
                     
                     let dynamicDescription = [];
                     for (const [key, value] of Object.entries(vars)) {
                         if (key.startsWith('__')) continue;
                         if (excludedKeySet.has(key)) continue;
                         if (key.toLowerCase().includes('phone')) continue;
                         if (key.toLowerCase().includes('confirmation')) continue;
                         if (typeof value === 'string' && genericConfirmations.has(value.toUpperCase().trim())) continue;
                         if (value === titleValue) continue;

                         const readableKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                         dynamicDescription.push(`${readableKey}: ${value}`);
                     }
                     
                     if (dynamicDescription.length === 0) {
                        dynamicDescription.push('Booking request via WhatsApp');
                     }

                     const requestData = {
                         businessId: business._id,
                         ownerId: business.ownerId || business._id,
                         contactId: contact._id,
                         title: requestTitle,
                         description: dynamicDescription.join('\n'),
                         status: "pending",
                         paymentStatus: "pending",
                         source: "whatsapp",
                         category: "service"
                     };

                     console.log("=========================================");
                     console.log("[Request Creation] Flow:", chatSession.currentFlowId);
                     console.log("  Contact Name:", customerName, "(from WhatsApp profile)");
                     console.log("  Title:", requestTitle);
                     console.log("  Description:", dynamicDescription);
                     console.log("  All Variables:", vars);
                     console.log("=========================================");

                     await Request.create(requestData);
                     console.log(`[Session] Flow completed and request created for ${from}`);
                 }

                 await ChatSession.deleteOne({ _id: chatSession._id });
              }
            }

            // 5. Send the reply using the specific business's Access Token
            if (replyData && replyData.type !== 'NoReply') {
              console.log('[DEBUG] Sending WhatsApp reply...');
              const sentMessageData = await this.sendMessage(from, replyData, phone_number_id, whatsappConfig.accessToken);

              if (sentMessageData && sentMessageData.messages && sentMessageData.messages[0]) {
                console.log('[SUCCESS] WhatsApp reply sent.');
                const outgoingMessageId = sentMessageData.messages[0].id;
                
                // Log the outgoing response in DB
                await conversationService.saveMessage(
                  conversation._id,
                  from, 
                  replyData.text,
                  'outgoing',
                  outgoingMessageId
                );
              } else {
                console.error('[Error] Failed to send WhatsApp reply, no message ID returned.');
              }
            } else {
              console.log(`No active DB flow matched "${msg_body}" for ${business.businessName} and no fallback found. No reply sent.`);
            }
          } catch (err) {
            console.error('\n[Error] Failed during message processing, flow, or sending:', err);
          }
        }
      } else {
        // Status updates
        if (
          payload.entry &&
          payload.entry[0].changes &&
          payload.entry[0].changes[0] &&
          payload.entry[0].changes[0].value.statuses
        ) {
          const statuses = payload.entry[0].changes[0].value.statuses;
          console.log(`\n[Status Update] Received status update(s): ${statuses.map(s => s.status).join(', ')}\n`);
        } else {
          console.log('Webhook received, but no message content found.');
        }
      }
    } catch (error) {
      console.error('\nError processing incoming WhatsApp message:', error);
    }
  }

  /**
   * Send a WhatsApp message using Cloud API
   * @param {string} to - The recipient's phone number
   * @param {Object} replyData - { text, buttons }
   * @param {string} phoneNumberId - The client's specific WhatsApp Phone Number ID
   * @param {string} businessToken - The client's specific WhatsApp Access Token
   */
  async sendMessage(to, replyData, phoneNumberId, businessToken) {
    try {
      if (!businessToken || !phoneNumberId) {
        console.error("Missing Business Access Token or Phone Number ID.");
        return null;
      }

      const url = `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`;
      let payload;

      // Construct interactive button payload if buttons exist or it's a Button Message
      if (replyData.type === 'Button Message' || (replyData.buttons && replyData.buttons.length > 0)) {
        const buttons = replyData.buttons || [];
        const buttonCount = Math.min(buttons.length, 3);
        const buttonsPayload = [];
        
        for (let i = 0; i < buttonCount; i++) {
          const btn = buttons[i];
          const payloadButtonId = String(btn.buttonId || btn.id || `btn_${i}`).trim();
          console.log("Saved Button ID:", btn.id);
          console.log("WhatsApp Payload Button ID:", payloadButtonId);
          buttonsPayload.push({
            type: 'reply',
            reply: {
              id: payloadButtonId,
              title: String(btn.text || btn.label || `Option ${i + 1}`).substring(0, 20) 
            }
          });
        }

        if (buttonsPayload.length > 0) {
          payload = {
            messaging_product: "whatsapp",
            to: to,
            type: "interactive",
            interactive: {
              type: "button",
              body: { text: replyData.text || 'Please select an option:' },
              action: { buttons: buttonsPayload }
            }
          };
        } else {
          // Fallback if no buttons found despite type
          payload = {
            messaging_product: "whatsapp",
            to: to,
            type: "text",
            text: { body: replyData.text || 'No options available.' }
          };
        }
      } else {
        payload = {
          messaging_product: "whatsapp",
          to: to,
          type: "text",
          text: { body: replyData.text || '' }
        };
      }

      // Payload Validation Check
      if (payload.type === 'text' && (!payload.text || !payload.text.body)) {
         console.error("Payload body is empty!");
         return null;
      } else if (payload.type === 'interactive' && (!payload.interactive.body || !payload.interactive.body.text)) {
         console.error("Payload interactive body is empty!");
         return null;
      }

      console.log(`\n[DEBUG] generated payload:`, JSON.stringify(payload, null, 2));

      const config = {
        headers: {
          "Authorization": `Bearer ${businessToken}`,
          "Content-Type": "application/json"
        }
      };

      console.log(`Sending POST request to: ${url}`);
      const response = await axios.post(url, payload, config);
      
      console.log(`\n[DEBUG] WhatsApp API response:`, JSON.stringify(response.data, null, 2));
      console.log(`\n--- Outgoing WhatsApp Reply ---`);
      console.log(`To: ${to}`);
      console.log(`Message Type: ${payload.type}`);
      console.log(`Message ID: ${response.data.messages[0].id}`);
      console.log(`-------------------------------\n`);

      return response.data;
    } catch (error) {
      console.error("\n[Error] Failed to send WhatsApp message:");
      if (error.response) {
        console.error(`Status Code: ${error.response.status}`);
        console.error('Response Data:', JSON.stringify(error.response.data, null, 2));
      } else if (error.request) {
        console.error('No response received from Meta API:', error.request);
      } else {
        console.error('Request Setup Error:', error.message);
      }
      return null;
    }
  }
}

module.exports = new WhatsappService();
