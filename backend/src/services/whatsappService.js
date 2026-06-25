const axios = require('axios');
const conversationService = require('./conversationService');
const chatbotService = require('./chatbotService');

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
        
        // We only handle text messages for this simple auto-reply
        if (message.type === 'text') {
          const msg_body = message.text.body; // text message body
          const timestamp = message.timestamp; // timestamp

          console.log('\n--- Incoming WhatsApp Message ---');
          console.log(`From: ${from}`);
          console.log(`Message: ${msg_body}`);
          console.log(`Message ID: ${messageId}`);
          console.log(`Timestamp: ${new Date(timestamp * 1000).toISOString()}`);
          console.log(`Target Phone ID: ${phone_number_id}`);
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

          // 3. Generate reply text using chatbot logic
          const replyText = await chatbotService.generateReply(msg_body);

          // 4. Send the reply
          const sentMessageData = await this.sendMessage(from, replyText);

          // 5. Save outgoing message if successfully sent
          if (sentMessageData && sentMessageData.messages && sentMessageData.messages[0]) {
            const outgoingMessageId = sentMessageData.messages[0].id;
            await conversationService.saveMessage(
              conversation._id,
              from, 
              replyText,
              'outgoing',
              outgoingMessageId
            );
          }
        }
      } else {
        // Some webhooks don't contain messages (e.g. status updates for read/delivered)
        if (
          payload.entry &&
          payload.entry[0].changes &&
          payload.entry[0].changes[0] &&
          payload.entry[0].changes[0].value.statuses
        ) {
          const statuses = payload.entry[0].changes[0].value.statuses;
          console.log(`\n[Status Update] Received status update(s): ${statuses.map(s => s.status).join(', ')}\n`);
        } else {
          console.log('Webhook received, but no message content found (might be a status update).');
        }
      }
    } catch (error) {
      console.error('\nError processing incoming WhatsApp message:', error);
      // We don't throw error to avoid crashing the server on bad payloads, just log it.
    }
  }

  /**
   * Send a WhatsApp message using Cloud API
   * @param {string} to - The recipient's phone number
   * @param {string} body - The text message to send
   */
  async sendMessage(to, body) {
    try {
      const token = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID;

      if (!token || !phoneNumberId) {
        console.error("Missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID in environment variables.");
        return null;
      }

      // Graph API v22.0 endpoint (can be updated to latest)
      const url = `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`;
      
      const payload = {
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: {
          body: body
        }
      };

      const config = {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      };

      // Use axios for API calls
      const response = await axios.post(url, payload, config);
      
      console.log(`\n--- Outgoing WhatsApp Reply ---`);
      console.log(`To: ${to}`);
      console.log(`Message: ${body}`);
      console.log(`Message ID: ${response.data.messages[0].id}`);
      console.log(`-------------------------------\n`);

      return response.data;
    } catch (error) {
      console.error("\nFailed to send WhatsApp message:");
      if (error.response) {
        console.error(JSON.stringify(error.response.data, null, 2));
      } else {
        console.error(error.message);
      }
      return null;
    }
  }
}

module.exports = new WhatsappService();
