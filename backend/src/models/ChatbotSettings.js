const mongoose = require('mongoose');

const chatbotSettingsSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      unique: true, // One settings document per business
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    isActive: {
      type: Boolean,
      default: false,
    },
    fallbackMessage: {
      type: String,
      default: "I'm sorry, I didn't understand that. Could you please rephrase?",
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

chatbotSettingsSchema.index({ ownerId: 1, businessId: 1 });

module.exports = mongoose.model('ChatbotSettings', chatbotSettingsSchema);
