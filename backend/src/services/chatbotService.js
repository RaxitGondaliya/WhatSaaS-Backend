const ChatbotFlow = require('../models/ChatbotFlow');

class ChatbotService {
  /**
   * Determine the appropriate reply for an incoming message.
   * @param {string} messageText - The text sent by the user
   * @returns {string} The reply text
   */
  async generateReply(messageText) {
    try {
      const lowerText = messageText.trim().toLowerCase();

      // 1. Try to match a dynamic chatbot flow from the database
      // This looks for an active flow where the triggerKeywords array contains the message text
      const matchingFlow = await ChatbotFlow.findOne({
        status: 'active',
        triggerKeywords: { $in: [lowerText] }
      });

      if (matchingFlow && matchingFlow.nodes && matchingFlow.nodes.length > 0) {
        // Attempt to extract text from the nodes array structure
        // This assumes a generic structure like { data: { text: 'reply' } } or { text: 'reply' }
        // Depending on how frontend saves the React Flow / Node-RED style nodes.
        for (const node of matchingFlow.nodes) {
          if (node.data && node.data.text) {
            return node.data.text;
          }
          if (node.text) {
            return node.text;
          }
        }
      }

      // 2. Basic Chatbot Logic (Fallback to hardcoded rules if no dynamic flow matched or no text found)
      switch (lowerText) {
        case 'hi':
        case 'hello':
          return 'Welcome to our service! How can we help you today?';
        case 'price':
        case 'pricing':
          return 'Our pricing plans start at $9/month. Reply "help" to speak with a representative for a custom quote.';
        case 'help':
        case 'support':
          return 'Support Info: Please visit our support center at https://support.example.com or reply with your query.';
        default:
          return 'Sorry, I did not understand that. You can type "hi", "price", or "help" for more options.';
      }

    } catch (error) {
      console.error('Error generating chatbot reply:', error);
      return 'We are currently experiencing technical difficulties. Please try again later.';
    }
  }
}

module.exports = new ChatbotService();
