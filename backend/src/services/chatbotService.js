const ChatbotFlow = require('../models/ChatbotFlow');

class ChatbotService {
  /**
   * Determine the appropriate reply for an incoming message.
   * @param {string} messageText - The text sent by the user
   * @param {string} businessId - The ID of the Business receiving the message
   * @returns {Object|null} The reply object containing { text, buttons } or null if no flow matches
   */
  async generateReply(messageText, businessId) {
    try {
      const lowerText = messageText.trim().toLowerCase();

      // 1. Try to match a dynamic chatbot flow for this specific business
      let flow = await ChatbotFlow.findOne({
        businessId: businessId,
        status: 'active',
        // using case-insensitive regex or just direct match since we usually save lowercase keywords
        triggerKeywords: { $in: [lowerText] }
      });

      // 2. If no keyword match, find the fallback flow for this business
      if (!flow) {
        flow = await ChatbotFlow.findOne({
          businessId: businessId,
          status: 'active',
          isFallback: true
        });
      }

      // 3. Construct the response from the found flow
      if (flow) {
        // Use the new structured schema if available
        if (flow.replyText) {
          return {
            text: flow.replyText,
            buttons: flow.buttons || []
          };
        }

        // Legacy support: extract text from nodes array if old schema is used
        if (flow.nodes && flow.nodes.length > 0) {
          for (const node of flow.nodes) {
            if (node.data && node.data.text) {
              return { text: node.data.text, buttons: [] };
            }
            if (node.text) {
              return { text: node.text, buttons: [] };
            }
          }
        }
      }

      // 4. No flow matched and no fallback defined in DB. Return null to avoid sending hardcoded messages.
      return null;

    } catch (error) {
      console.error('Error fetching chatbot flow from DB:', error);
      return null;
    }
  }
}

module.exports = new ChatbotService();
