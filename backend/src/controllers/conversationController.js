const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Business = require('../models/Business');

/**
 * GET /api/conversations
 * Get all conversations for the business
 */
exports.getConversations = async (req, res, next) => {
  try {
    const business = await Business.findOne({ ownerId: req.user.id });
    if (!business) {
      return res.status(404).json({ success: false, message: 'Business not found' });
    }

    const conversations = await Conversation.find({ businessId: business._id })
      .populate('contactId', 'name phone')
      .sort({ updatedAt: -1 });

    res.status(200).json({
      success: true,
      data: conversations,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/conversations/:id/messages
 * Get messages for a conversation
 */
exports.getConversationMessages = async (req, res, next) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      ownerId: req.user.id, // basic auth check
    });

    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    const messages = await Message.find({ conversationId: conversation._id })
      .sort({ timestamp: 1 });

    res.status(200).json({
      success: true,
      data: messages,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/conversations/analytics
 * Get basic chatbot analytics
 */
exports.getChatbotAnalytics = async (req, res, next) => {
  try {
    const business = await Business.findOne({ ownerId: req.user.id });
    if (!business) {
      return res.status(404).json({ success: false, message: 'Business not found' });
    }

    const totalConversations = await Conversation.countDocuments({ businessId: business._id });
    const totalMessages = await Message.countDocuments({ businessId: business._id });
    
    // Auto replies sent would be messages sent by the bot (direction: 'outbound' or 'outbound-api', triggeredBy: 'bot')
    // We'll estimate this by outbound messages
    const autoRepliesSent = await Message.countDocuments({ 
      businessId: business._id, 
      direction: 'outbound' 
    });
    
    const activeConversations = await Conversation.countDocuments({ 
      businessId: business._id, 
      status: 'active' 
    });
    
    const failedReplies = await Message.countDocuments({
      businessId: business._id,
      status: 'failed'
    });

    res.status(200).json({
      success: true,
      data: {
        totalConversations,
        totalMessages,
        autoRepliesSent,
        activeConversations,
        failedReplies
      }
    });
  } catch (error) {
    next(error);
  }
};
