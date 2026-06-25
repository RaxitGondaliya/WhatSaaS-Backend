const Conversation = require('../models/Conversation');
const Message = require('../models/Message');

class ConversationService {
  /**
   * Find an existing active conversation or create a new one for a sender.
   * @param {string} senderNumber - The sender's phone number
   * @returns {Object} The conversation document
   */
  async findOrCreateConversation(senderNumber) {
    try {
      let conversation = await Conversation.findOne({
        senderNumber,
        status: 'active',
      });

      if (!conversation) {
        conversation = await Conversation.create({
          senderNumber,
          status: 'active',
        });
      }

      return conversation;
    } catch (error) {
      console.error('Error in findOrCreateConversation:', error);
      throw error;
    }
  }

  /**
   * Save a message to the database and update conversation lastMessageAt.
   * @param {string} conversationId - The ID of the conversation
   * @param {string} senderNumber - The sender's phone number
   * @param {string} text - The message text
   * @param {string} direction - 'incoming' or 'outgoing'
   * @param {string} messageId - Optional Meta message ID
   * @returns {Object} The saved message document
   */
  async saveMessage(conversationId, senderNumber, text, direction, messageId = null) {
    try {
      const message = await Message.create({
        conversationId,
        senderNumber,
        text,
        direction,
        messageId,
        status: direction === 'outgoing' ? 'sent' : 'delivered'
      });

      await Conversation.findByIdAndUpdate(conversationId, {
        lastMessageAt: new Date(),
      });

      return message;
    } catch (error) {
      console.error('Error in saveMessage:', error);
      throw error;
    }
  }
}

module.exports = new ConversationService();
