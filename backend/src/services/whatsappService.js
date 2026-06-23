/**
 * Service to handle incoming WhatsApp webhook payloads.
 * This file is prepared for future chatbot and AI integrations.
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
        const phone_number_id = payload.entry[0].changes[0].value.metadata.phone_number_id;
        const from = payload.entry[0].changes[0].value.messages[0].from; // sender phone number
        const msg_body = payload.entry[0].changes[0].value.messages[0].text.body; // text message body
        const timestamp = payload.entry[0].changes[0].value.messages[0].timestamp; // timestamp

        console.log('\n--- Incoming WhatsApp Message ---');
        console.log(`From: ${from}`);
        console.log(`Message: ${msg_body}`);
        console.log(`Timestamp: ${new Date(timestamp * 1000).toISOString()}`);
        console.log(`Target Phone ID: ${phone_number_id}`);
        console.log('---------------------------------\n');

        // FUTURE: Send `msg_body` to Chatbot / AI flow
        // For example:
        // const response = await chatbotFlowService.process(msg_body, from);
        // await this.sendMessage(from, response);
      } else {
        // Some webhooks don't contain messages (e.g. status updates for read/delivered)
        console.log('Webhook received, but no message content found (might be a status update).');
      }
    } catch (error) {
      console.error('Error processing incoming WhatsApp message:', error);
      // We don't throw error to avoid crashing the server on bad payloads, just log it.
    }
  }
}

module.exports = new WhatsappService();
