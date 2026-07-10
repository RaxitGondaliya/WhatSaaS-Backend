const Contact = require('../models/Contact');
const Request = require('../models/Request');
const BroadcastCampaign = require('../models/BroadcastCampaign');
const User = require('../models/User');

const getDashboardScope = async (userId) => {
  const currentUser = await User.findById(userId);

  if (!currentUser) {
    return { errorStatus: 404, errorMessage: 'User not found' };
  }

  if (!currentUser.businessId) {
    return { errorStatus: 400, errorMessage: 'Business setup not found' };
  }

  const owner = currentUser.role === 'owner'
    ? currentUser
    : await User.findOne({ businessId: currentUser.businessId, role: 'owner' });

  return {
    businessId: currentUser.businessId,
    ownerId: owner?._id || currentUser._id,
  };
};

const sendScopeError = (res, scope) => {
  if (!scope.errorStatus) {
    return false;
  }

  res.status(scope.errorStatus).json({
    success: false,
    message: scope.errorMessage,
  });
  return true;
};

const formatContact = (contact) => ({
  _id: contact._id,
  name: contact.name,
  phone: contact.phone,
  email: contact.email,
  status: contact.status,
  source: contact.source,
  tags: contact.tags,
  lastInteractionAt: contact.lastInteractionAt,
  totalRequests: contact.totalRequests,
  totalSpent: contact.totalSpent,
  createdAt: contact.createdAt,
  updatedAt: contact.updatedAt,
});

const formatRequest = (request) => ({
  _id: request._id,
  requestNumber: request.requestNumber,
  title: request.title,
  category: request.category,
  status: request.status,
  priority: request.priority,
  paymentStatus: request.paymentStatus,
  amount: request.finalAmount || request.paidAmount || request.estimatedAmount || 0,
  contact: request.contactId
    ? {
      _id: request.contactId._id,
      name: request.contactId.name,
      phone: request.contactId.phone,
      email: request.contactId.email,
    }
    : null,
  createdAt: request.createdAt,
  updatedAt: request.updatedAt,
});

const formatBroadcast = (campaign) => ({
  _id: campaign._id,
  campaignName: campaign.campaignName,
  campaignType: campaign.campaignType,
  status: campaign.status,
  estimatedRecipients: campaign.estimatedRecipients,
  totalSent: campaign.totalSent,
  totalDelivered: campaign.totalDelivered,
  totalFailed: campaign.totalFailed,
  scheduleAt: campaign.scheduleAt,
  sentAt: campaign.sentAt,
  createdAt: campaign.createdAt,
  updatedAt: campaign.updatedAt,
});

/**
 * GET /api/dashboard/overview
 * Real dashboard overview for the logged-in user's business.
 */
exports.getOverview = async (req, res, next) => {
  try {
    const scope = await getDashboardScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const baseQuery = {
      businessId: scope.businessId,
      ownerId: scope.ownerId,
    };
    const contactQuery = {
      ...baseQuery,
      isDeleted: false,
      status: 'active',
    };

    const matchQuery = {
      ...baseQuery,
      status: { $in: ['sent', 'completed'] }
    };

    const [
      totalContacts,
      totalRequests,
      pendingRequests,
      completedRequests,
      activeBroadcasts,
      sentTotals,
      recentRequests,
      recentBroadcasts,
      recentActiveContacts,
    ] = await Promise.all([
      Contact.countDocuments(contactQuery),
      Request.countDocuments(baseQuery),
      Request.countDocuments({ ...baseQuery, status: 'pending' }),
      Request.countDocuments({ ...baseQuery, status: 'completed' }),
      BroadcastCampaign.countDocuments(matchQuery),
      BroadcastCampaign.aggregate([
        { $match: matchQuery },
        { 
          $group: { 
            _id: null, 
            messagesSent: { 
              $sum: {
                $cond: [
                  { $gt: [{ $ifNull: ['$totalDelivered', 0] }, 0] },
                  '$totalDelivered',
                  { $ifNull: ['$totalSent', 0] }
                ]
              }
            } 
          } 
        },
      ]),
      Request.find(baseQuery)
        .populate('contactId', 'name phone email')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      BroadcastCampaign.find(baseQuery)
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      Contact.find({ ...contactQuery, status: 'active' })
        .sort({ lastInteractionAt: -1, createdAt: -1 })
        .limit(5)
        .lean(),
    ]);

    res.status(200).json({
      success: true,
      data: {
        summary: {
          totalContacts,
          messagesSent: sentTotals[0]?.messagesSent || 0,
          activeBroadcasts,
          walletBalance: 0,
          totalRequests,
          pendingRequests,
          completedRequests,
        },
        recentRequests: recentRequests.map(formatRequest),
        recentBroadcasts: recentBroadcasts.map(formatBroadcast),
        recentActiveContacts: recentActiveContacts.map(formatContact),
      },
    });
  } catch (error) {
    next(error);
  }
};
