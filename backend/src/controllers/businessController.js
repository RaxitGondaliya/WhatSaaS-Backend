const Business = require('../models/Business');
const User = require('../models/User');

const formatBusiness = (business) => ({
  _id: business._id,
  ownerId: business.ownerId,
  businessName: business.businessName,
  ownerName: business.ownerName,
  businessCategory: business.businessCategory,
  businessEmail: business.businessEmail,
  whatsappNumber: business.whatsappNumber,
  city: business.city,
  logo: business.logo,
  usageType: business.usageType,
  customUsageType: business.customUsageType,
  whatsappConnectionStatus: business.whatsappConnectionStatus,
  metaVerificationStatus: business.metaVerificationStatus,
  createdAt: business.createdAt,
  updatedAt: business.updatedAt,
});

const validateUsageType = (usageType, customUsageType) => {
  if (usageType === 'other' && !customUsageType?.trim()) {
    return 'Custom usage type is required when usage type is other';
  }

  return null;
};

/**
 * POST /api/business/setup
 * Create business setup for logged-in owner
 */
exports.setupBusiness = async (req, res, next) => {
  try {
    const ownerId = req.user.id;
    const {
      businessName,
      ownerName,
      businessCategory,
      businessEmail,
      whatsappNumber,
      city,
      usageType,
      customUsageType,
    } = req.body;

    if (!businessName || !ownerName || !businessCategory || !whatsappNumber) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields',
      });
    }

    const usageTypeError = validateUsageType(usageType, customUsageType);
    if (usageTypeError) {
      return res.status(400).json({
        success: false,
        message: usageTypeError,
      });
    }

    const existingBusiness = await Business.findOne({ ownerId });
    if (existingBusiness) {
      return res.status(409).json({
        success: false,
        message: 'Business setup already exists for this owner',
      });
    }

    const businessData = {
      ownerId,
      businessName,
      ownerName,
      businessCategory,
      businessEmail: businessEmail || null,
      whatsappNumber,
      city: city || null,
    };

    if (usageType) {
      businessData.usageType = usageType;
      businessData.customUsageType = usageType === 'other' ? customUsageType : null;
    }

    const business = await Business.create(businessData);

    await User.findByIdAndUpdate(ownerId, { businessId: business._id });

    res.status(201).json({
      success: true,
      message: 'Business setup completed successfully',
      business: formatBusiness(business),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Business setup already exists for this owner',
      });
    }

    next(error);
  }
};

/**
 * GET /api/business/my-business
 * Get logged-in user's business
 */
exports.getMyBusiness = async (req, res, next) => {
  try {
    const business = await Business.findOne({ ownerId: req.user.id });

    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found',
      });
    }

    res.status(200).json({
      success: true,
      business: formatBusiness(business),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/business/update
 * Update logged-in user's business details
 */
exports.updateBusiness = async (req, res, next) => {
  try {
    const allowedFields = [
      'businessName',
      'ownerName',
      'businessCategory',
      'businessEmail',
      'whatsappNumber',
      'city',
      'logo',
      'whatsappConnectionStatus',
      'metaVerificationStatus',
    ];

    const updates = {};
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    const business = await Business.findOneAndUpdate(
      { ownerId: req.user.id },
      updates,
      { new: true, runValidators: true }
    );

    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Business updated successfully',
      business: formatBusiness(business),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/business/usage-type
 * Update logged-in user's business usage type
 */
exports.updateUsageType = async (req, res, next) => {
  try {
    const { usageType, customUsageType } = req.body;

    if (!usageType) {
      return res.status(400).json({
        success: false,
        message: 'Please provide usage type',
      });
    }

    const usageTypeError = validateUsageType(usageType, customUsageType);
    if (usageTypeError) {
      return res.status(400).json({
        success: false,
        message: usageTypeError,
      });
    }

    const business = await Business.findOneAndUpdate(
      { ownerId: req.user.id },
      {
        usageType,
        customUsageType: usageType === 'other' ? customUsageType : null,
      },
      { new: true, runValidators: true }
    );

    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Usage type updated successfully',
      business: formatBusiness(business),
    });
  } catch (error) {
    next(error);
  }
};
