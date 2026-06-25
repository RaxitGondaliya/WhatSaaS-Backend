const ChatbotSettings = require('../models/ChatbotSettings');
const Business = require('../models/Business');

/**
 * GET /api/chatbot-settings
 * Get chatbot settings for the logged-in user's business
 */
exports.getSettings = async (req, res, next) => {
  try {
    const business = await Business.findOne({ ownerId: req.user.id });
    if (!business) {
      return res.status(404).json({ success: false, message: 'Business not found' });
    }

    let settings = await ChatbotSettings.findOne({ businessId: business._id });
    if (!settings) {
      // Create default settings if they don't exist
      settings = await ChatbotSettings.create({
        businessId: business._id,
        ownerId: req.user.id,
      });
    }

    res.status(200).json({
      success: true,
      data: settings,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/chatbot-settings
 * Update chatbot settings
 */
exports.updateSettings = async (req, res, next) => {
  try {
    const business = await Business.findOne({ ownerId: req.user.id });
    if (!business) {
      return res.status(404).json({ success: false, message: 'Business not found' });
    }

    const { isActive, fallbackMessage } = req.body;
    const updates = {};
    if (isActive !== undefined) updates.isActive = Boolean(isActive);
    if (fallbackMessage !== undefined) updates.fallbackMessage = String(fallbackMessage);

    const settings = await ChatbotSettings.findOneAndUpdate(
      { businessId: business._id },
      { $set: updates },
      { new: true, runValidators: true, upsert: true }
    );

    res.status(200).json({
      success: true,
      data: settings,
    });
  } catch (error) {
    next(error);
  }
};
