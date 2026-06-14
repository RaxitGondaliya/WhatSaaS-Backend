const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema(
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
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    phone: {
      type: String,
      required: [true, 'Phone is required'],
      trim: true,
    },
    email: {
      type: String,
      default: '',
      trim: true,
      lowercase: true,
    },
    address: {
      type: String,
      default: '',
      trim: true,
    },
    city: {
      type: String,
      default: '',
      trim: true,
    },
    tags: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: {
        values: ['active', 'inactive', 'blocked'],
        message: 'Status must be active, inactive, or blocked',
      },
      default: 'active',
    },
    source: {
      type: String,
      enum: {
        values: ['manual', 'import', 'whatsapp', 'chatbot'],
        message: 'Source must be manual, import, whatsapp, or chatbot',
      },
      default: 'manual',
    },
    notes: {
      type: String,
      default: '',
      trim: true,
    },
    lastInteractionAt: {
      type: Date,
      default: null,
    },
    totalRequests: {
      type: Number,
      default: 0,
    },
    totalSpent: {
      type: Number,
      default: 0,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

contactSchema.index(
  { ownerId: 1, businessId: 1, phone: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
contactSchema.index({ name: 'text', phone: 'text', email: 'text' });

module.exports = mongoose.model('Contact', contactSchema);
