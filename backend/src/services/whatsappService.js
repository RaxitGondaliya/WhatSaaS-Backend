const axios = require('axios');

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
        
        // We only handle text messages for this simple auto-reply
        if (message.type === 'text') {
          const msg_body = message.text.body; // text message body
          const timestamp = message.timestamp; // timestamp

          console.log('\n--- Incoming WhatsApp Message ---');
          console.log(`From: ${from}`);
          console.log(`Message: ${msg_body}`);
          console.log(`Timestamp: ${new Date(timestamp * 1000).toISOString()}`);
          console.log(`Target Phone ID: ${phone_number_id}`);
          console.log('---------------------------------\n');

          // Auto-reply with the requested format
          const replyText = `Hello, I received your message: ${msg_body}`;
          await this.sendMessage(from, replyText);
        }
      } else {
        // Some webhooks don't contain messages (e.g. status updates for read/delivered)
        console.log('Webhook received, but no message content found (might be a status update).');
      }
    } catch (error) {
      console.error('Error processing incoming WhatsApp message:', error);
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
      const token = process.env.WHATSAPP_TOKEN;
      const phoneNumberId = process.env.PHONE_NUMBER_ID;

      if (!token || !phoneNumberId) {
        console.error("Missing WHATSAPP_TOKEN or PHONE_NUMBER_ID in environment variables.");
        return;
      }

      // Graph API v17.0 endpoint (can be updated to latest)
      const url = `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`;
      
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

      // 7. Use axios for API calls
      const response = await axios.post(url, payload, config);
      console.log(`Message sent successfully to ${to}. Message ID: ${response.data.messages[0].id}`);
    } catch (error) {
      console.error("Failed to send WhatsApp message:");
      if (error.response) {
        console.error(JSON.stringify(error.response.data, null, 2));
      } else {
        console.error(error.message);
      }
    }
  }
}

module.exports = new WhatsappService();
