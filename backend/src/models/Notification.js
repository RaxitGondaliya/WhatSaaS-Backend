const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
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
    type: {
      type: String,
      enum: {
        values: ['new_request', 'whatsapp_request', 'payment_pending', 'low_wallet', 'system'],
        message: 'Invalid notification type',
      },
      required: [true, 'Notification type is required'],
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
    },
    message: {
      type: String,
      required: [true, 'Message is required'],
      trim: true,
    },
    referenceType: {
      type: String,
      default: '',
      trim: true,
    },
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    isCleared: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

notificationSchema.index({ ownerId: 1, businessId: 1, isRead: 1, isCleared: 1, createdAt: -1 });
notificationSchema.index({ ownerId: 1, businessId: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
