const mongoose = require('mongoose');

const notificationPreferenceSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner is required'],
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      default: null,
    },
    newRequest: {
      type: Boolean,
      default: true,
    },
    whatsappRequest: {
      type: Boolean,
      default: true,
    },
    paymentPending: {
      type: Boolean,
      default: true,
    },
    lowWallet: {
      type: Boolean,
      default: true,
    },
    soundEnabled: {
      type: Boolean,
      default: true,
    },
    emailEnabled: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

notificationPreferenceSchema.index({ ownerId: 1, businessId: 1 }, { unique: true });

module.exports = mongoose.model('NotificationPreference', notificationPreferenceSchema);
