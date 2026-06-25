const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    senderNumber: {
      type: String,
      required: [true, 'Sender number is required'],
      index: true,
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      default: null,
    },
    status: {
      type: String,
      enum: ['active', 'resolved'],
      default: 'active',
    },
    currentFlowId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChatbotFlow',
      default: null,
    },
    lastNodeId: {
      type: String, // E.g. the trigger keyword or step identifier
      default: null,
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Conversation', conversationSchema);
