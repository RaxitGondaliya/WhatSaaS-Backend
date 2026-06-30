const axios = require('axios');
const conversationService = require('./conversationService');
const chatbotEngineService = require('../chatbotEngine/chatbotEngineService');
const businessService = require('./businessService');

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

        // Handle normal text messages
        if (message.type === 'text') {
          msg_body = message.text.body;
        } 
        // Handle interactive button clicks
        else if (message.type === 'interactive') {
          if (message.interactive.type === 'button_reply') {
            msg_body = message.interactive.button_reply.title || message.interactive.button_reply.id;
          } else if (message.interactive.type === 'list_reply') {
            msg_body = message.interactive.list_reply.title || message.interactive.list_reply.id;
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

            // 4. Generate dynamic reply using the new Chatbot Engine
            console.log('Generating reply from DB...');
            const replyData = await chatbotEngineService.processMessage(msg_body, business, conversation);

            // 5. Send the reply using the specific business's Access Token
            if (replyData) {
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
          buttonsPayload.push({
            type: 'reply',
            reply: {
              id: String(btn.nextMessageId || btn.id || btn.nextFlowKeyword || btn.text || `btn_${i}`),
              title: (btn.text || `Option ${i + 1}`).substring(0, 20) 
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
