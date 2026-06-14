const mongoose = require('mongoose');

const broadcastCampaignSchema = new mongoose.Schema(
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
    campaignName: {
      type: String,
      required: [true, 'Campaign name is required'],
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    campaignType: {
      type: String,
      enum: {
        values: ['marketing', 'utility', 'reminder', 'custom'],
        message: 'Campaign type must be marketing, utility, reminder, or custom',
      },
      default: 'marketing',
    },
    messageFormat: {
      type: String,
      enum: {
        values: ['text', 'image', 'video', 'document'],
        message: 'Message format must be text, image, video, or document',
      },
      default: 'text',
    },
    messageContent: {
      type: String,
      default: '',
      trim: true,
    },
    mediaUrl: {
      type: String,
      default: '',
      trim: true,
    },
    mediaName: {
      type: String,
      default: '',
      trim: true,
    },
    buttons: {
      type: [
        {
          text: {
            type: String,
            default: '',
            trim: true,
          },
          type: {
            type: String,
            enum: {
              values: ['url', 'phone', 'quick_reply'],
              message: 'Button type must be url, phone, or quick_reply',
            },
            default: 'quick_reply',
          },
          value: {
            type: String,
            default: '',
            trim: true,
          },
        },
      ],
      default: [],
    },
    variables: {
      type: [String],
      default: [],
    },
    recipientsType: {
      type: String,
      enum: {
        values: ['all_contacts', 'contact_group', 'selected_contacts'],
        message: 'Recipients type must be all_contacts, contact_group, or selected_contacts',
      },
      default: 'all_contacts',
    },
    selectedContacts: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Contact',
        },
      ],
      default: [],
    },
    contactGroup: {
      type: String,
      default: '',
      trim: true,
    },
    estimatedRecipients: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: {
        values: ['draft', 'scheduled', 'sent', 'cancelled'],
        message: 'Status must be draft, scheduled, sent, or cancelled',
      },
      default: 'draft',
    },
    scheduleAt: {
      type: Date,
      default: null,
    },
    sentAt: {
      type: Date,
      default: null,
    },
    totalSent: {
      type: Number,
      default: 0,
    },
    totalDelivered: {
      type: Number,
      default: 0,
    },
    totalFailed: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

broadcastCampaignSchema.index({ ownerId: 1, businessId: 1, status: 1 });
broadcastCampaignSchema.index({ ownerId: 1, businessId: 1, campaignType: 1 });
broadcastCampaignSchema.index({ campaignName: 'text', description: 'text', messageContent: 'text' });

module.exports = mongoose.model('BroadcastCampaign', broadcastCampaignSchema);
