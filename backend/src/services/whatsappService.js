const axios = require('axios');
const conversationService = require('./conversationService');
const chatbotService = require('./chatbotService');
const Business = require('../models/Business');

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
        
        // Find the business associated with this phone number id
        const business = await Business.findOne({ phoneNumberId: phone_number_id });
        if (!business) {
          console.warn(`\n[Warning] No Business configured for phoneNumberId: ${phone_number_id}. Skipping processing.`);
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

          // 1. Find or create conversation
          const conversation = await conversationService.findOrCreateConversation(from);

          // 2. Save incoming message
          await conversationService.saveMessage(
            conversation._id,
            from,
            msg_body,
            'incoming',
            messageId
          );

          // 3. Generate dynamic reply data using database chatbot flows
          const replyData = await chatbotService.generateReply(msg_body, business._id);

          // 4. Send the reply if a flow was found
          if (replyData) {
            const sentMessageData = await this.sendMessage(from, replyData, phone_number_id);

            // 5. Save outgoing message if successfully sent
            if (sentMessageData && sentMessageData.messages && sentMessageData.messages[0]) {
              console.log('Message sent successfully!');
              const outgoingMessageId = sentMessageData.messages[0].id;
              await conversationService.saveMessage(
                conversation._id,
                from, 
                replyData.text,
                'outgoing',
                outgoingMessageId
              );
            }
          } else {
            console.log(`No active DB flow matched "${msg_body}" for ${business.businessName} and no fallback found. No reply sent.`);
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
   * @param {string} phoneNumberIdFallback - The ID from webhook to support multi-tenant routing
   */
  async sendMessage(to, replyData, phoneNumberIdFallback) {
    try {
      const rawToken = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
      const rawPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID;
      
      const token = rawToken ? rawToken.trim() : null;
      // Prioritize webhook payload phone ID for multi-tenant, otherwise fallback to .env global
      const phoneNumberId = phoneNumberIdFallback || (rawPhoneId ? rawPhoneId.trim() : null);

      if (!token || !phoneNumberId) {
        console.error("Missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID in environment variables.");
        return null;
      }

      const url = `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`;
      
      let payload;

      // Construct interactive button payload if buttons exist
      if (replyData.buttons && replyData.buttons.length > 0) {
        // Meta API only allows a maximum of 3 buttons for an interactive message
        const buttonCount = Math.min(replyData.buttons.length, 3);
        const buttonsPayload = [];
        
        for (let i = 0; i < buttonCount; i++) {
          const btn = replyData.buttons[i];
          buttonsPayload.push({
            type: 'reply',
            reply: {
              // ID must be unique. Title max length is 20 chars.
              id: btn.nextFlowKeyword || btn.text || `btn_${i}`,
              title: btn.text.substring(0, 20) 
            }
          });
        }

        payload = {
          messaging_product: "whatsapp",
          to: to,
          type: "interactive",
          interactive: {
            type: "button",
            body: { text: replyData.text },
            action: { buttons: buttonsPayload }
          }
        };
      } else {
        // Standard text payload
        payload = {
          messaging_product: "whatsapp",
          to: to,
          type: "text",
          text: { body: replyData.text }
        };
      }

      const config = {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      };

      console.log(`Sending POST request to: ${url}`);
      const response = await axios.post(url, payload, config);
      
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
