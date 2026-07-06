const mongoose = require('mongoose');
const Counter = require('./Counter');

const requestSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: [true, 'Business is required'],
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner is required'],
    },
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Contact',
      required: [true, 'Contact is required'],
    },
    requestNumber: {
      type: String,
      unique: true,
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    category: {
      type: String,
      enum: {
        values: ['service', 'booking', 'order', 'repair', 'other'],
        message: 'Category must be service, booking, order, repair, or other',
      },
      required: [true, 'Category is required'],
    },
    source: {
      type: String,
      enum: {
        values: ['manual', 'chatbot', 'whatsapp'],
        message: 'Source must be manual, chatbot, or whatsapp',
      },
      default: 'manual',
    },
    status: {
      type: String,
      enum: {
        values: ['pending', 'in_progress', 'completed', 'cancelled'],
        message: 'Status must be pending, in_progress, completed, or cancelled',
      },
      default: 'pending',
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    priority: {
      type: String,
      enum: {
        values: ['low', 'medium', 'high'],
        message: 'Priority must be low, medium, or high',
      },
      default: 'medium',
    },
    completedItems: {
      type: [
        {
          itemName: {
            type: String,
            default: '',
            trim: true,
          },
          price: {
            type: Number,
            default: 0,
          },
        },
      ],
      default: [],
    },
    estimatedAmount: {
      type: Number,
      default: 0,
    },
    finalAmount: {
      type: Number,
      default: 0,
    },
    paidAmount: {
      type: Number,
      default: 0,
    },
    expenseItems: {
      type: [
        {
          expenseName: {
            type: String,
            default: '',
            trim: true,
          },
          amount: {
            type: Number,
            default: 0,
          },
        },
      ],
      default: [],
    },
    expenseAmount: {
      type: Number,
      default: 0,
    },
    totalExpense: {
      type: Number,
      default: 0,
    },
    profitAmount: {
      type: Number,
      default: 0,
    },
    paymentStatus: {
      type: String,
      enum: {
        values: ['completed', 'pending'],
        message: 'Payment status must be completed or pending',
      },
      default: 'pending',
    },
    completionNotes: {
      type: String,
      default: '',
      trim: true,
    },
    internalNotes: {
      type: [
        {
          text: {
            type: String,
            default: '',
            trim: true,
          },
          note: {
            type: String,
            default: '',
            trim: true,
          },
          createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
          },
          createdByName: {
            type: String,
            default: '',
            trim: true,
          },
          createdAt: {
            type: Date,
            default: Date.now,
          },
        },
      ],
      default: [],
    },
    timeline: {
      type: [
        {
          event: {
            type: String,
            required: true,
            trim: true,
          },
          message: {
            type: String,
            default: '',
            trim: true,
          },
          createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
          },
          createdAt: {
            type: Date,
            default: Date.now,
          },
        },
      ],
      default: [],
    },
    completedAt: {
      type: Date,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

requestSchema.index({ businessId: 1, status: 1 });
requestSchema.index({ businessId: 1, contactId: 1 });
requestSchema.index({ title: 'text', description: 'text', requestNumber: 'text' });

requestSchema.pre('validate', async function (next) {
  if (this.requestNumber) {
    return next();
  }

  try {
    const counterId = 'requestNumber';
    const existingCounter = await Counter.findById(counterId);

    if (!existingCounter) {
      const [latestRequest] = await this.constructor.aggregate([
        { $match: { requestNumber: /^REQ-\d+$/ } },
        { $project: { seq: { $toInt: { $substrBytes: ['$requestNumber', 4, 20] } } } },
        { $sort: { seq: -1 } },
        { $limit: 1 },
      ]);
      const initialSeq = Math.max((latestRequest?.seq || 1000) - 1000, 0);

      try {
        await Counter.updateOne(
          { _id: counterId },
          { $setOnInsert: { seq: initialSeq } },
          { upsert: true }
        );
      } catch (error) {
        if (error.code !== 11000) {
          throw error;
        }
      }
    }

    const counter = await Counter.findOneAndUpdate(
      { _id: counterId },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    this.requestNumber = `REQ-${1000 + counter.seq}`;
    next();
  } catch (error) {
    next(error);
  }
});

module.exports = mongoose.model('Request', requestSchema);
