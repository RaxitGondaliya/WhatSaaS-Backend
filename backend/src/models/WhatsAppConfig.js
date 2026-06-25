const mongoose = require('mongoose');

const whatsappConfigSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: [true, 'Business ID is required'],
      unique: true,
    },
    phoneNumberId: {
      type: String,
      required: [true, 'Phone Number ID is required'],
      unique: true,
      trim: true,
    },
    whatsappBusinessAccountId: {
      type: String,
      trim: true,
      default: null,
    },
    accessToken: {
      type: String,
      required: [true, 'Access Token is required'],
      trim: true,
    },
    verifyToken: {
      type: String,
      trim: true,
      default: null, // Used if they register their own webhook
    },
    chatbotEnabled: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('WhatsAppConfig', whatsappConfigSchema);
