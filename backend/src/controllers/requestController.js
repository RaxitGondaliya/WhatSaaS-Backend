const Request = require('../models/Request');
const Contact = require('../models/Contact');
const User = require('../models/User');
const { createRequestNotification } = require('../utils/notificationService');

const VALID_CATEGORIES = ['service', 'booking', 'order', 'repair', 'other'];
const VALID_SOURCES = ['manual', 'chatbot', 'whatsapp'];
const VALID_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];
const VALID_PRIORITIES = ['low', 'medium', 'high'];
const VALID_PAYMENT_STATUSES = ['completed', 'pending'];

const normalizeText = (value) => {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim().toLowerCase();
};

const normalizeOptionalString = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
};

const normalizeOptionalEmail = (value) => normalizeOptionalString(value).toLowerCase();

const toAmount = (value, defaultValue = 0) => {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : defaultValue;
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
  if (!value) {
    return null;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return endOfDate ? endOfDay(parsed) : startOfDay(parsed);
};

const getCreatedAtFilter = ({ dateFilter, dateFrom, dateTo }) => {
  const customFrom = parseDateParam(dateFrom);
  const customTo = parseDateParam(dateTo, true);

  if (customFrom || customTo) {
    return {
      ...(customFrom ? { $gte: customFrom } : {}),
      ...(customTo ? { $lte: customTo } : {}),
    };
  }

  const normalizedDateFilter = normalizeText(dateFilter) || 'all';
  const now = new Date();

  if (normalizedDateFilter === 'today') {
    return {
      $gte: startOfDay(now),
      $lte: endOfDay(now),
    };
  }

  if (normalizedDateFilter === 'yesterday') {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    return {
      $gte: startOfDay(yesterday),
      $lte: endOfDay(yesterday),
    };
  }

  if (normalizedDateFilter === 'this_week') {
    const start = startOfDay(now);
    const day = start.getDay();
    const daysSinceMonday = day === 0 ? 6 : day - 1;
    start.setDate(start.getDate() - daysSinceMonday);

    return {
      $gte: start,
      $lte: now,
    };
  }

  if (normalizedDateFilter === 'this_month') {
    return {
      $gte: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0),
      $lte: now,
    };
  }

  return null;
};

const normalizeExpenseItems = (expenseItems) => {
  if (expenseItems === undefined) {
    return { provided: false, items: [], total: 0 };
  }

  if (!Array.isArray(expenseItems)) {
    return { provided: true, error: 'Expense items must be an array' };
  }

  const items = expenseItems.map((item) => ({
    expenseName: normalizeOptionalString(item?.expenseName),
    amount: toAmount(item?.amount, 0),
  }));

  return {
    provided: true,
    items,
    total: items.reduce((sum, item) => sum + item.amount, 0),
  };
};

const formatContactSummary = (contact) => {
  if (!contact || !contact.name) {
    return contact;
  }

  return {
    _id: contact._id,
    name: contact.name,
    phone: contact.phone,
    email: contact.email,
    address: contact.address || '',
    city: contact.city || '',
  };
};

const formatInternalNotes = (notes = []) => notes.map((note) => ({
  _id: note._id,
  text: note.text || note.note || '',
  createdByName: note.createdByName || note.createdBy?.fullName || '',
  createdAt: note.createdAt,
}));

const formatRequest = (request) => ({
  _id: request._id,
  businessId: request.businessId,
  ownerId: request.ownerId,
  contactId: formatContactSummary(request.contactId),
  requestNumber: request.requestNumber,
  title: request.title,
  description: request.description,
  category: request.category,
  source: request.source,
  status: request.status,
  requestStatus: request.status,
  assignedTo: request.assignedTo,
  priority: request.priority,
  estimatedAmount: request.estimatedAmount,
  completedItems: request.completedItems,
  finalAmount: request.finalAmount,
  paidAmount: request.paidAmount,
  expenseItems: request.expenseItems,
  expenseAmount: request.expenseAmount,
  totalExpense: request.totalExpense,
  profitAmount: request.profitAmount,
  paymentStatus: request.paymentStatus,
  completionNotes: request.completionNotes,
  internalNotes: formatInternalNotes(request.internalNotes),
  timeline: request.timeline,
  completedAt: request.completedAt,
  cancelledAt: request.cancelledAt,
  createdAt: request.createdAt,
  updatedAt: request.updatedAt,
});

const getRequestScope = async (userId) => {
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
    currentUser,
    businessId: currentUser.businessId,
    ownerId: owner?._id || currentUser._id,
  };
};

const findScopedContact = async (scope, contactId) => {
  return Contact.findOne({
    _id: contactId,
    businessId: scope.businessId,
    isDeleted: false,
  });
};

const findScopedRequest = async (scope, requestId) => {
  return Request.findOne({
    _id: requestId,
    businessId: scope.businessId,
  })
    .populate('contactId', 'name phone email address city')
    .populate('assignedTo', 'fullName email role')
    .populate('internalNotes.createdBy', 'fullName');
};

const findOrCreateRequestContact = async (scope, contactId, contactInput) => {
  if (contactId) {
    const contact = await findScopedContact(scope, contactId);

    if (!contact) {
      return { errorStatus: 404, errorMessage: 'Contact not found' };
    }

    return { contact };
  }

  if (!contactInput) {
    return { errorStatus: 400, errorMessage: 'Contact is required' };
  }

  const name = normalizeOptionalString(contactInput.name);
  const phone = normalizeOptionalString(contactInput.phone);

  if (!name || !phone) {
    return { errorStatus: 400, errorMessage: 'Contact name and phone are required' };
  }

  const query = {
    businessId: scope.businessId,
    phone,
    isDeleted: false,
  };
  const existingContact = await Contact.findOne(query);

  if (existingContact) {
    return { contact: existingContact };
  }

  const contact = await Contact.create({
    ownerId: scope.ownerId,
    businessId: scope.businessId,
    source: 'manual',
    name,
    phone,
    email: normalizeOptionalEmail(contactInput.email),
    address: normalizeOptionalString(contactInput.address),
    city: normalizeOptionalString(contactInput.city),
    createdBy: scope.currentUser._id,
  });

  return { contact };
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

const validateRequestInput = ({ category, source, status, priority }) => {
  if (category !== undefined && !VALID_CATEGORIES.includes(category)) {
    return 'Category must be service, booking, order, repair, or other';
  }

  if (source !== undefined && !VALID_SOURCES.includes(source)) {
    return 'Source must be manual, chatbot, or whatsapp';
  }

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return 'Status must be pending, in_progress, completed, or cancelled';
  }

  if (priority !== undefined && !VALID_PRIORITIES.includes(priority)) {
    return 'Priority must be low, medium, or high';
  }

  return null;
};

const addTimelineEvent = (request, event, message, createdBy) => {
  request.timeline.push({
    event,
    message: message || '',
    createdBy,
    createdAt: new Date(),
  });
};

/**
 * GET /api/requests
 * List requests for current business
 */
exports.getRequests = async (req, res, next) => {
  try {
    const scope = await getRequestScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const {
      status,
      priority,
      source,
      contactId,
      search,
      dateFilter,
      dateFrom,
      dateTo,
    } = req.query;

    console.log(`[getRequests] Received filter status: ${status}`);

    const baseQuery = { businessId: scope.businessId };
    const createdAtFilter = getCreatedAtFilter({ dateFilter, dateFrom, dateTo });
    if (createdAtFilter) baseQuery.createdAt = createdAtFilter;

    // 1. STATS QUERY (UNFILTERED BY STATUS)
    const totalRequests = await Request.countDocuments(baseQuery);
    const pendingCount = await Request.countDocuments({ ...baseQuery, status: 'pending' });
    const inProgressCount = await Request.countDocuments({ ...baseQuery, status: 'in_progress' });
    const completedCount = await Request.countDocuments({ ...baseQuery, status: 'completed' });
    const cancelledCount = await Request.countDocuments({ ...baseQuery, status: 'cancelled' });
    const pendingPaymentCount = await Request.countDocuments({ ...baseQuery, status: 'completed', paymentStatus: 'pending' });

    console.log(`[getRequests] Global Counts -> Total: ${totalRequests}, Pending: ${pendingCount}, In Progress: ${inProgressCount}, Completed: ${completedCount}, Cancelled: ${cancelledCount}`);

    // 2. LIST FILTERING
    const query = { ...baseQuery };

    if (status) {
      if (status === 'pending_payments' || status === 'pending_payment') {
        query.status = 'completed';
        query.paymentStatus = 'pending';
      } else {
        query.status = normalizeText(status);
      }
    }

    if (priority) query.priority = normalizeText(priority);
    if (source) query.source = normalizeText(source);
    if (contactId) query.contactId = contactId;

    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [
        { title: searchRegex },
        { description: searchRegex },
        { requestNumber: searchRegex },
      ];
    }

    const requests = await Request.find(query)
      .populate('contactId', 'name phone email address city')
      .populate('assignedTo', 'fullName email role')
      .sort({ createdAt: -1 });

    const returnedRequests = requests.map(formatRequest);
    
    console.log(`[getRequests] Returning ${requests.length} requests`);
    
    res.status(200).json({
      success: true,
      count: requests.length,
      requests: returnedRequests,
      stats: {
         total: totalRequests,
         pending: pendingCount,
         in_progress: inProgressCount,
         completed: completedCount,
         cancelled: cancelledCount,
         pending_payments: pendingPaymentCount
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/requests
 * Create manual request
 */
exports.createRequest = async (req, res, next) => {
  try {
    const scope = await getRequestScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const {
      contactId,
      contact: contactInput,
      title,
      description = '',
      category,
      priority = 'medium',
      estimatedAmount = 0,
      assignedTo = null,
    } = req.body;

    const normalizedCategory = normalizeText(category);
    const normalizedPriority = normalizeText(priority) || 'medium';

    if (!title || !normalizedCategory) {
      return res.status(400).json({
        success: false,
        message: 'Title and category are required',
      });
    }

    const validationError = validateRequestInput({
      category: normalizedCategory,
      priority: normalizedPriority,
      source: 'manual',
    });

    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }

    const contactResult = await findOrCreateRequestContact(scope, contactId, contactInput);
    if (contactResult.errorStatus) {
      return res.status(contactResult.errorStatus).json({
        success: false,
        message: contactResult.errorMessage,
      });
    }

    const request = await Request.create({
      businessId: scope.businessId,
      ownerId: scope.ownerId,
      contactId: contactResult.contact._id,
      title,
      description,
      category: normalizedCategory,
      source: 'manual',
      priority: normalizedPriority,
      estimatedAmount: toAmount(estimatedAmount, 0),
      assignedTo,
    });
    await request.populate('contactId', 'name phone email address city');
    try {
      await createRequestNotification({
        scope,
        request,
        customerName: request.contactId?.name || contactResult.contact.name,
        source: 'manual',
      });
    } catch (notificationError) {
      console.error('Notification creation failed:', notificationError.message);
    }

    res.status(201).json({
      success: true,
      message: 'Request created successfully',
      request: formatRequest(request),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/requests/:id
 * Get request details
 */
exports.getRequest = async (req, res, next) => {
  try {
    const scope = await getRequestScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const request = await findScopedRequest(scope, req.params.id);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found',
      });
    }

    res.status(200).json({
      success: true,
      request: formatRequest(request),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/requests/:id
 * Edit request fields
 */
exports.updateRequest = async (req, res, next) => {
  try {
    const scope = await getRequestScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const request = await Request.findOne({
      _id: req.params.id,
      businessId: scope.businessId,
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found',
      });
    }

    const updates = {};
    const editableFields = [
      'title',
      'description',
      'category',
      'source',
      'assignedTo',
      'priority',
      'estimatedAmount',
      'finalAmount',
      'paidAmount',
      'expenseAmount',
      'totalExpense',
      'completionNotes',
    ];

    editableFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    if (updates.category !== undefined) updates.category = normalizeText(updates.category);
    if (updates.source !== undefined) updates.source = normalizeText(updates.source);
    if (updates.priority !== undefined) updates.priority = normalizeText(updates.priority);

    const validationError = validateRequestInput({
      category: updates.category,
      source: updates.source,
      priority: updates.priority,
    });

    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }

    Object.assign(request, updates);

    if (updates.estimatedAmount !== undefined) {
      request.estimatedAmount = toAmount(updates.estimatedAmount, 0);
    }

    if (updates.paidAmount !== undefined) {
      request.paidAmount = toAmount(updates.paidAmount, 0);
      request.finalAmount = request.paidAmount;
    } else if (updates.finalAmount !== undefined) {
      request.finalAmount = toAmount(updates.finalAmount, 0);
      request.paidAmount = request.finalAmount;
    }

    if (updates.totalExpense !== undefined) {
      request.totalExpense = toAmount(updates.totalExpense, 0);
      request.expenseAmount = request.totalExpense;
    } else if (updates.expenseAmount !== undefined) {
      request.expenseAmount = toAmount(updates.expenseAmount, 0);
      request.totalExpense = request.expenseAmount;
    }

    if (
      updates.finalAmount !== undefined
      || updates.paidAmount !== undefined
      || updates.expenseAmount !== undefined
      || updates.totalExpense !== undefined
    ) {
      request.profitAmount = request.paidAmount - request.totalExpense;
    }

    await request.save();

    res.status(200).json({
      success: true,
      message: 'Request updated successfully',
      request: formatRequest(request),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/requests/:id/status
 * Update request status with allowed transitions
 */
exports.updateRequestStatus = async (req, res, next) => {
  try {
    const scope = await getRequestScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const normalizedStatus = normalizeText(req.body.status);

    if (!normalizedStatus) {
      return res.status(400).json({
        success: false,
        message: 'Status is required',
      });
    }

    if (!VALID_STATUSES.includes(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be pending, in_progress, completed, or cancelled',
      });
    }

    const request = await Request.findOne({
      _id: req.params.id,
      businessId: scope.businessId,
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found',
      });
    }

    const allowedTransitions = {
      pending: ['in_progress', 'cancelled'],
      in_progress: ['completed'],
      completed: [],
      cancelled: [],
    };

    if (!allowedTransitions[request.status].includes(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot change request status from ${request.status} to ${normalizedStatus}`,
      });
    }

    request.status = normalizedStatus;

    if (normalizedStatus === 'completed') {
      request.completedAt = new Date();
      addTimelineEvent(request, 'Request Completed', '', scope.currentUser._id);
    }

    if (normalizedStatus === 'cancelled') {
      request.cancelledAt = new Date();
      addTimelineEvent(request, 'Request Cancelled', '', scope.currentUser._id);
    }

    if (normalizedStatus === 'in_progress') {
      addTimelineEvent(request, 'Request moved to In Progress', '', scope.currentUser._id);
    }

    await request.save();

    res.status(200).json({
      success: true,
      message: 'Request status updated successfully',
      request: formatRequest(request),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/requests/:id/complete
 * Complete request with financial details
 */
exports.completeRequest = async (req, res, next) => {
  try {
    const scope = await getRequestScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const request = await Request.findOne({
      _id: req.params.id,
      businessId: scope.businessId,
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found',
      });
    }

    let reqPaymentStatus = normalizeText(req.body.paymentStatus) || 'completed';
    if (reqPaymentStatus === 'paid') reqPaymentStatus = 'completed';
    const paymentStatus = reqPaymentStatus;
    const expenseItemsResult = normalizeExpenseItems(req.body.expenseItems);

    if (!VALID_PAYMENT_STATUSES.includes(paymentStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Payment status must be completed or pending',
      });
    }

    if (expenseItemsResult.error) {
      return res.status(400).json({
        success: false,
        message: expenseItemsResult.error,
      });
    }

    const paidAmount = toAmount(req.body.paidAmount ?? req.body.finalAmount, 0);
    const totalExpense = expenseItemsResult.provided
      ? expenseItemsResult.total
      : toAmount(req.body.totalExpense ?? req.body.expenseAmount, 0);
    const profitAmount = paidAmount - totalExpense;

    request.paidAmount = paidAmount;
    request.finalAmount = paidAmount;
    request.expenseItems = expenseItemsResult.provided ? expenseItemsResult.items : [];
    request.totalExpense = totalExpense;
    request.expenseAmount = totalExpense;
    request.profitAmount = profitAmount;
    request.completionNotes = req.body.completionNotes || '';
    request.paymentStatus = paymentStatus;
    request.status = 'completed';
    request.completedAt = new Date();
    request.cancelledAt = null;
    addTimelineEvent(request, 'Request Completed', request.completionNotes, scope.currentUser._id);

    await request.save();

    res.status(200).json({
      success: true,
      message: 'Request completed successfully',
      request: formatRequest(request),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/requests/:id/mark-paid
 * Mark completed or pending-payment request as paid
 */
exports.markRequestPaid = async (req, res, next) => {
  try {
    const scope = await getRequestScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const request = await Request.findOne({
      _id: req.params.id,
      businessId: scope.businessId,
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found',
      });
    }

    request.paymentStatus = 'completed';
    const paidAmount = toAmount(request.paidAmount ?? request.finalAmount, 0);
    const totalExpense = toAmount(request.totalExpense ?? request.expenseAmount, 0);
    request.paidAmount = paidAmount;
    request.finalAmount = paidAmount;
    request.totalExpense = totalExpense;
    request.expenseAmount = totalExpense;
    request.profitAmount = paidAmount - totalExpense;
    addTimelineEvent(request, 'Payment Marked Completed', '', scope.currentUser._id);

    await request.save();

    res.status(200).json({
      success: true,
      message: 'Payment marked as completed successfully',
      request: formatRequest(request),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/requests/:id/notes
 * Add an internal note to a request
 */
exports.addInternalNote = async (req, res, next) => {
  try {
    const scope = await getRequestScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const text = normalizeOptionalString(req.body.text ?? req.body.note);

    if (!text) {
      return res.status(400).json({
        success: false,
        message: 'Note is required',
      });
    }

    const request = await Request.findOne({
      _id: req.params.id,
      businessId: scope.businessId,
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found',
      });
    }

    request.internalNotes.push({
      text,
      createdBy: scope.currentUser._id,
      createdByName: scope.currentUser.fullName,
      createdAt: new Date(),
    });
    addTimelineEvent(request, 'Internal Note Added', text, scope.currentUser._id);

    await request.save();

    res.status(201).json({
      success: true,
      message: 'Internal note added successfully',
      request: formatRequest(request),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/requests/:id/cancel
 * Cancel request
 */
exports.cancelRequest = async (req, res, next) => {
  try {
    const scope = await getRequestScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const request = await Request.findOne({
      _id: req.params.id,
      businessId: scope.businessId,
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found',
      });
    }

    request.status = 'cancelled';
    request.cancelledAt = new Date();
    request.completionNotes = req.body.reason || request.completionNotes;
    addTimelineEvent(request, 'Request Cancelled', request.completionNotes, scope.currentUser._id);

    await request.save();

    res.status(200).json({
      success: true,
      message: 'Request cancelled successfully',
      request: formatRequest(request),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/requests/from-chatbot
 * Future chatbot/WhatsApp request creation
 */
exports.createRequestFromChatbot = async (req, res, next) => {
  try {
    const scope = await getRequestScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const {
      contactId,
      title,
      description = '',
      source = 'chatbot',
      category = 'other',
      priority = 'medium',
    } = req.body;

    const normalizedSource = normalizeText(source) || 'chatbot';
    const normalizedCategory = normalizeText(category) || 'other';
    const normalizedPriority = normalizeText(priority) || 'medium';

    if (!contactId || !title) {
      return res.status(400).json({
        success: false,
        message: 'Contact and title are required',
      });
    }

    if (!['chatbot', 'whatsapp'].includes(normalizedSource)) {
      return res.status(400).json({
        success: false,
        message: 'Source must be chatbot or whatsapp',
      });
    }

    const validationError = validateRequestInput({
      category: normalizedCategory,
      source: normalizedSource,
      priority: normalizedPriority,
    });

    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }

    const contact = await findScopedContact(scope, contactId);
    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'Contact not found',
      });
    }

    const request = await Request.create({
      businessId: scope.businessId,
      ownerId: scope.ownerId,
      contactId,
      title,
      description,
      category: normalizedCategory,
      source: normalizedSource,
      priority: normalizedPriority,
    });
    try {
      await createRequestNotification({
        scope,
        request,
        customerName: contact.name,
        source: normalizedSource,
      });
    } catch (notificationError) {
      console.error('Notification creation failed:', notificationError.message);
    }

    res.status(201).json({
      success: true,
      message: 'Request created from chatbot successfully',
      request: formatRequest(request),
    });
  } catch (error) {
    next(error);
  }
};
