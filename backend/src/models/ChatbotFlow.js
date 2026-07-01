const mongoose = require('mongoose');

const chatbotFlowSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      default: null,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner is required'],
    },
    flowName: {
      type: String,
      required: [true, 'Flow name is required'],
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    triggerKeywords: {
      type: [String],
      default: [],
    },
    triggerType: {
      type: String,
      enum: {
        values: ['keyword', 'keywords', 'any', 'both', 'button_click', 'default'],
        message: 'Trigger type must be keyword, keywords, any, both, button_click, or default',
      },
      default: 'keywords',
    },
    triggerId: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: {
        values: ['draft', 'active', 'inactive'],
        message: 'Status must be draft, active, or inactive',
      },
      default: 'draft',
    },
    replyText: {
      type: String,
      trim: true,
      default: '',
    },
    buttons: [{
      text: {
        type: String,
        trim: true,
      },
      nextFlowKeyword: {
        type: String,
        trim: true,
      }
    }],
    isFallback: {
      type: Boolean,
      default: false,
    },
    nodes: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    edges: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    settings: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

chatbotFlowSchema.index({ ownerId: 1, businessId: 1, status: 1 });
chatbotFlowSchema.index({ ownerId: 1, businessId: 1, flowName: 1 });

module.exports = mongoose.model('ChatbotFlow', chatbotFlowSchema);
