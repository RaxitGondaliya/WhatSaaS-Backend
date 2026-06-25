const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: [true, 'Conversation ID is required'],
      index: true,
    },
    senderNumber: {
      type: String,
      required: [true, 'Sender number is required'],
    },
    text: {
      type: String,
      required: [true, 'Message text is required'],
    },
    direction: {
      type: String,
      enum: ['incoming', 'outgoing'],
      required: [true, 'Message direction is required'],
    },
    messageId: {
      type: String, // WhatsApp Message ID
      default: null,
    },
    status: {
      type: String,
      enum: ['sent', 'delivered', 'read', 'failed'],
      default: 'sent',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Message', messageSchema);
