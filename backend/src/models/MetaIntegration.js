const mongoose = require('mongoose');

const metaIntegrationSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner ID is required'],
      unique: true,
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: [true, 'Business ID is required'],
      unique: true,
    },
    systemUserAccessToken: {
      type: String,
      required: [true, 'System User Access Token is required'],
      trim: true,
    },
    metaAccountId: {
      type: String,
      trim: true,
      default: null,
    },
    tokenExpiry: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['active', 'disconnected', 'expired'],
      default: 'active',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('MetaIntegration', metaIntegrationSchema);
