const mongoose = require('mongoose');

const chatSessionSchema = new mongoose.Schema(
  {
    phoneNumber: {
      type: String,
      required: true,
      index: true,
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },
    currentFlowId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChatbotFlow',
      required: true,
    },
    currentNodeId: {
      type: String,
      required: true,
    },
    variables: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    isWaitingForInput: {
      type: Boolean,
      default: false
    },
    targetVariable: {
      type: String
    }
  },
  {
    timestamps: true,
  }
);

// TTL index to automatically clear abandoned sessions after 1 hour (3600 seconds)
chatSessionSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 3600 });
// Compound index for fast lookup
chatSessionSchema.index({ phoneNumber: 1, businessId: 1 });

module.exports = mongoose.model('ChatSession', chatSessionSchema);
