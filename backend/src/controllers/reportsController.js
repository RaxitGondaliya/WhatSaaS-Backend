const Request = require('../models/Request');
const Contact = require('../models/Contact');
const BroadcastCampaign = require('../models/BroadcastCampaign');
const ChatbotFlow = require('../models/ChatbotFlow');
const User = require('../models/User');

const REQUEST_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];
const PAYMENT_STATUSES = ['completed', 'pending'];
const CONTACT_STATUSES = ['active', 'inactive', 'blocked'];
const BROADCAST_STATUSES = ['draft', 'scheduled', 'sent', 'cancelled'];
const FLOW_STATUSES = ['draft', 'active', 'inactive'];

const normalizeText = (value) => {
  if (typeof value !== 'string') return value;
  return value.trim().toLowerCase();
};

const normalizeEnumText = (value) => {
  if (typeof value !== 'string') return value;

  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
};

const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

const getRevenue = (request) => {
  const finalAmount = toAmount(request.finalAmount);
  const paidAmount = toAmount(request.paidAmount);

  return finalAmount || paidAmount;
};

const startOfDay = (date) => new Date(
  date.getFullYear(),
  date.getMonth(),
  date.getDate(),
  0,
  0,
  0,
  0
);

const endOfDay = (date) => new Date(
  date.getFullYear(),
  date.getMonth(),
  date.getDate(),
  23,
  59,
  59,
  999
);

const parseDateParam = (value, endOfDate = false) => {
  if (!value) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  return endOfDate ? endOfDay(parsed) : startOfDay(parsed);
};

const getDateRange = (query = {}) => {
  if (query.month || query.year) {
    const year = Number.parseInt(query.year, 10);
    const month = Number.parseInt(query.month, 10);

    if (!Number.isNaN(year) && !Number.isNaN(month) && month >= 1 && month <= 12) {
      return {
        from: new Date(year, month - 1, 1, 0, 0, 0, 0),
        to: new Date(year, month, 0, 23, 59, 59, 999),
      };
    }

    if (!Number.isNaN(year)) {
      return {
        from: new Date(year, 0, 1, 0, 0, 0, 0),
        to: new Date(year, 11, 31, 23, 59, 59, 999),
      };
    }
  }

  const customFrom = parseDateParam(query.dateFrom || query.from || query.startDate);
  const customTo = parseDateParam(query.dateTo || query.to || query.endDate, true);

  if (customFrom || customTo) {
    return { from: customFrom, to: customTo };
  }

  const dateFilter = normalizeEnumText(query.dateFilter || query.filter || 'all');
  const now = new Date();

  if (!dateFilter || dateFilter === 'all' || dateFilter === 'custom_date_range') {
    return { from: null, to: null };
  }

  if (dateFilter === 'today') {
    return { from: startOfDay(now), to: endOfDay(now) };
  }

  if (dateFilter === 'yesterday') {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    return { from: startOfDay(yesterday), to: endOfDay(yesterday) };
  }

  if (dateFilter === 'this_week') {
    const start = startOfDay(now);
    const day = start.getDay();
    const daysSinceMonday = day === 0 ? 6 : day - 1;
    start.setDate(start.getDate() - daysSinceMonday);
    return { from: start, to: now };
  }

  if (dateFilter === 'this_month') {
    return {
      from: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0),
      to: now,
    };
  }

  return { from: null, to: null };
};

const buildDateQuery = (field, range) => {
  if (!range.from && !range.to) return {};

  return {
    [field]: {
      ...(range.from ? { $gte: range.from } : {}),
      ...(range.to ? { $lte: range.to } : {}),
    },
  };
};

const buildPaymentDateQuery = (range) => {
  if (!range.from && !range.to) return {};

  const bounds = {
    ...(range.from ? { $gte: range.from } : {}),
    ...(range.to ? { $lte: range.to } : {}),
  };

  return {
    $or: [
      { completedAt: bounds },
      { completedAt: null, createdAt: bounds },
    ],
  };
};

const getReportScope = async (userId) => {
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
  if (!scope.errorStatus) return false;

  res.status(scope.errorStatus).json({
    success: false,
    message: scope.errorMessage,
  });
  return true;
};

const getPagination = (query) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 10, 1), 100);

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
};

const buildSearchQuery = (search, fields) => {
  if (!search) return {};

  const regex = new RegExp(escapeRegex(search), 'i');
  return {
    $or: fields.map((field) => ({ [field]: regex })),
  };
};

const getMatchingContactIds = async (scope, search) => {
  if (!search) return [];

  const contactQuery = {
    businessId: scope.businessId,
    ownerId: scope.ownerId,
    isDeleted: false,
    ...buildSearchQuery(search, ['name', 'phone', 'email']),
  };
  const contacts = await Contact.find(contactQuery).select('_id').lean();

  return contacts.map((contact) => contact._id);
};

const addStatusFilter = (query, status, validStatuses, field = 'status') => {
  const normalizedStatus = normalizeEnumText(status);
  if (normalizedStatus && validStatuses.includes(normalizedStatus)) {
    query[field] = normalizedStatus;
  }
};

const formatCustomer = (contact) => ({
  customerName: contact?.name || '',
  phone: contact?.phone || '',
});

const formatRequestReport = (request) => ({
  ...formatCustomer(request.contactId),
  service: request.title || request.category || '',
  status: request.status,
  paymentStatus: request.paymentStatus,
  amount: roundMoney(getRevenue(request)),
  createdAt: request.createdAt,
});

const formatBroadcastReport = (campaign) => ({
  campaignName: campaign.campaignName,
  campaignType: campaign.campaignType,
  status: campaign.status,
  estimatedRecipients: campaign.estimatedRecipients,
  scheduleAt: campaign.scheduleAt,
  sentAt: campaign.sentAt,
  totalSent: campaign.totalSent,
  totalDelivered: campaign.totalDelivered,
  totalFailed: campaign.totalFailed,
  createdAt: campaign.createdAt,
});

const formatContactReport = (contact) => ({
  name: contact.name,
  phone: contact.phone,
  email: contact.email,
  status: contact.status,
  source: contact.source,
  tags: contact.tags,
  createdAt: contact.createdAt,
});

const formatChatbotFlowReport = (flow) => ({
  flowName: flow.flowName,
  status: flow.status,
  triggerType: flow.triggerType,
  triggerKeywords: flow.triggerKeywords,
  messageCount: Array.isArray(flow.nodes) ? flow.nodes.length : 0,
  createdAt: flow.createdAt,
  updatedAt: flow.updatedAt,
});

const formatPaymentReport = (request) => {
  const amount = getRevenue(request);
  const paidAmount = request.paymentStatus === 'completed' ? amount : 0;
  const pendingAmount = request.paymentStatus === 'pending' ? amount : 0;

  return {
    customerName: request.contactId?.name || '',
    requestTitle: request.title,
    paidAmount: roundMoney(paidAmount),
    pendingAmount: roundMoney(pendingAmount),
    paymentStatus: request.paymentStatus,
    date: request.completedAt || request.createdAt,
  };
};

const sendPaginatedReport = async ({
  res,
  model,
  query,
  pagination,
  formatter,
  sort = { createdAt: -1 },
  populate = [],
}) => {
  const findQuery = model.find(query).sort(sort).skip(pagination.skip).limit(pagination.limit);

  populate.forEach((populateOption) => {
    findQuery.populate(populateOption);
  });

  const [items, total] = await Promise.all([
    findQuery.lean(),
    model.countDocuments(query),
  ]);

  res.status(200).json({
    success: true,
    data: items.map(formatter),
    total,
    page: pagination.page,
    limit: pagination.limit,
  });
};

exports.getSummary = async (req, res, next) => {
  try {
    const scope = await getReportScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const range = getDateRange(req.query);
    const baseQuery = {
      businessId: scope.businessId,
      ownerId: scope.ownerId,
    };
    const createdAtQuery = buildDateQuery('createdAt', range);
    const paymentDateQuery = buildPaymentDateQuery(range);

    const [
      totalContacts,
      totalRequests,
      revenueRequests,
      pendingPaymentRequests,
      totalBroadcastCampaigns,
      totalChatbotFlows,
    ] = await Promise.all([
      Contact.countDocuments({ ...baseQuery, isDeleted: false, ...createdAtQuery }),
      Request.countDocuments({ ...baseQuery, ...createdAtQuery }),
      Request.find({ ...baseQuery, status: 'completed', ...paymentDateQuery }).select('paidAmount finalAmount').lean(),
      Request.find({ ...baseQuery, paymentStatus: 'pending', ...paymentDateQuery })
        .select('paidAmount finalAmount')
        .lean(),
      BroadcastCampaign.countDocuments({ ...baseQuery, ...createdAtQuery }),
      ChatbotFlow.countDocuments({ ...baseQuery, ...createdAtQuery }),
    ]);

    const totalRevenue = revenueRequests.reduce((sum, request) => sum + getRevenue(request), 0);
    const pendingPayments = pendingPaymentRequests.reduce((sum, request) => sum + getRevenue(request), 0);

    res.status(200).json({
      success: true,
      data: {
        totalRequests,
        totalContacts,
        totalRevenue: roundMoney(totalRevenue),
        pendingPaymentsAmount: roundMoney(pendingPayments),
        totalBroadcasts: totalBroadcastCampaigns,
        totalChatbotFlows,
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.getRequestsReport = async (req, res, next) => {
  try {
    const scope = await getReportScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const range = getDateRange(req.query);
    const query = {
      businessId: scope.businessId,
      ownerId: scope.ownerId,
      ...buildDateQuery('createdAt', range),
    };
    const search = req.query.search;

    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      const contactIds = await getMatchingContactIds(scope, search);
      query.$or = [
        { requestNumber: regex },
        { title: regex },
        { category: regex },
        { status: regex },
        ...(contactIds.length ? [{ contactId: { $in: contactIds } }] : []),
      ];
    }

    addStatusFilter(query, req.query.status, REQUEST_STATUSES);

    await sendPaginatedReport({
      res,
      model: Request,
      query,
      pagination: getPagination(req.query),
      formatter: formatRequestReport,
      populate: [{ path: 'contactId', select: 'name phone' }],
    });
  } catch (error) {
    next(error);
  }
};

exports.getBroadcastsReport = async (req, res, next) => {
  try {
    const scope = await getReportScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const query = {
      businessId: scope.businessId,
      ownerId: scope.ownerId,
      ...buildDateQuery('createdAt', getDateRange(req.query)),
      ...buildSearchQuery(req.query.search, ['campaignName', 'description', 'messageContent', 'campaignType']),
    };
    addStatusFilter(query, req.query.status, BROADCAST_STATUSES);

    await sendPaginatedReport({
      res,
      model: BroadcastCampaign,
      query,
      pagination: getPagination(req.query),
      formatter: formatBroadcastReport,
    });
  } catch (error) {
    next(error);
  }
};

exports.getContactsReport = async (req, res, next) => {
  try {
    const scope = await getReportScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const query = {
      businessId: scope.businessId,
      ownerId: scope.ownerId,
      isDeleted: false,
      ...buildDateQuery('createdAt', getDateRange(req.query)),
      ...buildSearchQuery(req.query.search, ['name', 'phone', 'email', 'source']),
    };
    addStatusFilter(query, req.query.status, CONTACT_STATUSES);

    await sendPaginatedReport({
      res,
      model: Contact,
      query,
      pagination: getPagination(req.query),
      formatter: formatContactReport,
    });
  } catch (error) {
    next(error);
  }
};

exports.getChatbotReport = async (req, res, next) => {
  try {
    const scope = await getReportScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const query = {
      businessId: scope.businessId,
      ownerId: scope.ownerId,
      ...buildDateQuery('createdAt', getDateRange(req.query)),
      ...buildSearchQuery(req.query.search, ['flowName', 'description', 'triggerKeywords', 'triggerType']),
    };
    addStatusFilter(query, req.query.status, FLOW_STATUSES);

    await sendPaginatedReport({
      res,
      model: ChatbotFlow,
      query,
      pagination: getPagination(req.query),
      formatter: formatChatbotFlowReport,
      sort: { updatedAt: -1, createdAt: -1 },
    });
  } catch (error) {
    next(error);
  }
};

exports.getPaymentsReport = async (req, res, next) => {
  try {
    const scope = await getReportScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const range = getDateRange(req.query);
    const dateQuery = buildPaymentDateQuery(range);
    const query = {
      businessId: scope.businessId,
      ownerId: scope.ownerId,
    };
    const andFilters = [
      {
        $or: [
          { status: 'completed' },
          { paymentStatus: 'pending' },
        ],
      },
    ];

    if (Object.keys(dateQuery).length) {
      andFilters.push(dateQuery);
    }

    const search = req.query.search;

    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      const contactIds = await getMatchingContactIds(scope, search);
      andFilters.push({
        $or: [
          { requestNumber: regex },
          { title: regex },
          ...(contactIds.length ? [{ contactId: { $in: contactIds } }] : []),
        ],
      });
    }

    addStatusFilter(query, req.query.status, PAYMENT_STATUSES, 'paymentStatus');

    if (andFilters.length) {
      query.$and = andFilters;
    }

    await sendPaginatedReport({
      res,
      model: Request,
      query,
      pagination: getPagination(req.query),
      formatter: formatPaymentReport,
      sort: { completedAt: -1, updatedAt: -1, createdAt: -1 },
      populate: [{ path: 'contactId', select: 'name phone' }],
    });
  } catch (error) {
    next(error);
  }
};
