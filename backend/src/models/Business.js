const mongoose = require('mongoose');

const businessSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner is required'],
      unique: true,
    },
    businessName: {
      type: String,
      required: [true, 'Business name is required'],
      trim: true,
    },
    ownerName: {
      type: String,
      required: [true, 'Owner name is required'],
      trim: true,
    },
    businessCategory: {
      type: String,
      required: [true, 'Business category is required'],
      trim: true,
    },
    businessEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
    whatsappNumber: {
      type: String,
      required: [true, 'WhatsApp number is required'],
      trim: true,
    },
    phoneNumberId: {
      type: String,
      trim: true,
      default: null,
    },
    accessToken: {
      type: String,
      trim: true,
      default: null,
    },
    chatbotFlowId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChatbotFlow',
      default: null,
    },
    city: {
      type: String,
      trim: true,
      default: null,
    },
    logo: {
      type: String,
      default: null,
    },
    usageType: {
      type: String,
      enum: {
        values: ['services', 'bookings', 'orders', 'repairs', 'other'],
        message: 'Usage type must be services, bookings, orders, repairs, or other',
      },
    },
    customUsageType: {
      type: String,
      trim: true,
      default: null,
      required: function () {
        return this.usageType === 'other';
      },
    },
    whatsappConnectionStatus: {
      type: String,
      enum: {
        values: ['connected', 'not_connected'],
        message: 'WhatsApp connection status must be connected or not_connected',
      },
      default: 'not_connected',
    },
    metaVerificationStatus: {
      type: String,
      enum: {
        values: ['verified', 'pending', 'not_verified'],
        message: 'Meta verification status must be verified, pending, or not_verified',
      },
      default: 'not_verified',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Business', businessSchema);
