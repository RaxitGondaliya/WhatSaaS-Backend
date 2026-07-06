const Request = require('../models/Request');
const User = require('../models/User');

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const normalizeText = (value) => {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim().toLowerCase();
};

const normalizeStatus = (status) => {
  const normalized = normalizeText(status);

  if (!normalized) {
    return '';
  }

  const underscored = normalized.replace(/[\s-]+/g, '_');

  if (underscored === 'in_progress' || underscored === 'inprogress') {
    return 'in_progress';
  }

  if (underscored === 'pending') {
    return 'pending';
  }

  if (underscored === 'completed') {
    return 'completed';
  }

  if (underscored === 'cancelled' || underscored === 'canceled') {
    return 'cancelled';
  }

  return underscored;
};

const normalizeServiceKey = (value) => {
  const normalized = normalizeText(value);
  return normalized ? normalized.replace(/\s+/g, ' ') : 'other';
};

const formatServiceName = (value) => {
  if (typeof value !== 'string') {
    return 'Other';
  }

  return value.trim().replace(/\s+/g, ' ') || 'Other';
};

const toAmount = (value) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
};

const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

const roundPercent = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

const getRevenue = (request) => toAmount(request.paidAmount ?? request.finalAmount);

const getExpense = (request) => toAmount(request.totalExpense ?? request.expenseAmount);

const getProfit = (request) => {
  if (request.profitAmount !== undefined && request.profitAmount !== null) {
    return toAmount(request.profitAmount);
  }

  return getRevenue(request) - getExpense(request);
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

const getDateRange = ({ dateFilter, dateFrom, dateTo }) => {
  const customFrom = parseDateParam(dateFrom);
  const customTo = parseDateParam(dateTo, true);

  if (customFrom || customTo) {
    return {
      from: customFrom,
      to: customTo,
    };
  }

  const normalizedDateFilter = normalizeText(dateFilter) || 'this_month';
  const now = new Date();

  if (normalizedDateFilter === 'all') {
    return { from: null, to: null };
  }

  if (normalizedDateFilter === 'today') {
    return {
      from: startOfDay(now),
      to: endOfDay(now),
    };
  }

  if (normalizedDateFilter === 'yesterday') {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    return {
      from: startOfDay(yesterday),
      to: endOfDay(yesterday),
    };
  }

  if (normalizedDateFilter === 'this_week') {
    const start = startOfDay(now);
    const day = start.getDay();
    const daysSinceMonday = day === 0 ? 6 : day - 1;
    start.setDate(start.getDate() - daysSinceMonday);

    return {
      from: start,
      to: now,
    };
  }

  if (normalizedDateFilter === 'last_3_months') {
    return {
      from: new Date(now.getFullYear(), now.getMonth() - 2, 1, 0, 0, 0, 0),
      to: now,
    };
  }

  if (normalizedDateFilter === 'last_6_months') {
    return {
      from: new Date(now.getFullYear(), now.getMonth() - 5, 1, 0, 0, 0, 0),
      to: now,
    };
  }

  if (normalizedDateFilter === 'last_12_months') {
    return {
      from: new Date(now.getFullYear(), now.getMonth() - 11, 1, 0, 0, 0, 0),
      to: now,
    };
  }

  return {
    from: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0),
    to: now,
  };
};

const buildDateQuery = (field, range) => {
  if (!range.from && !range.to) {
    return {};
  }

  return {
    [field]: {
      ...(range.from ? { $gte: range.from } : {}),
      ...(range.to ? { $lte: range.to } : {}),
    },
  };
};

const buildFinanceDateQuery = (range) => {
  if (!range.from && !range.to) {
    return {};
  }

  const dateBounds = {
    ...(range.from ? { $gte: range.from } : {}),
    ...(range.to ? { $lte: range.to } : {}),
  };

  return {
    $or: [
      { completedAt: dateBounds },
      { completedAt: null, createdAt: dateBounds },
    ],
  };
};

const buildBaseQuery = (scope) => ({
  businessId: scope.businessId,
  ownerId: scope.ownerId,
});

const buildCompletedFinanceQuery = (scope, range) => ({
  ...buildBaseQuery(scope),
  ...buildFinanceDateQuery(range),
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

const getFinanceDate = (request) => request.completedAt || request.createdAt;

const getProfitMargin = (profit, revenue) => {
  if (!revenue) {
    return 0;
  }

  return roundPercent((profit / revenue) * 100);
};

const getPercent = (count, total) => {
  if (!total) {
    return 0;
  }

  return roundPercent((count / total) * 100);
};

const buildMonthlyTrend = (requests, range) => {
  const now = new Date();
  const start = range.from || new Date(now.getFullYear(), now.getMonth() - 5, 1, 0, 0, 0, 0);
  const end = range.to || now;
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1, 0, 0, 0, 0);
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1, 0, 0, 0, 0);
  const monthMap = new Map();

  while (cursor <= endMonth && monthMap.size < 24) {
    const key = `${cursor.getFullYear()}-${cursor.getMonth()}`;
    monthMap.set(key, {
      label: MONTH_LABELS[cursor.getMonth()],
      revenue: 0,
      expense: 0,
      profit: 0,
      requests: 0,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  requests.forEach((request) => {
    const date = getFinanceDate(request);
    if (!date) return;

    const key = `${date.getFullYear()}-${date.getMonth()}`;
    if (!monthMap.has(key)) return;

    const revenue = getRevenue(request);
    const expense = getExpense(request);
    const profit = getProfit(request);
    const trend = monthMap.get(key);

    trend.revenue += revenue;
    trend.expense += expense;
    trend.profit += profit;
    trend.requests += 1;
  });

  return Array.from(monthMap.values()).map((trend) => ({
    ...trend,
    revenue: roundMoney(trend.revenue),
    expense: roundMoney(trend.expense),
    profit: roundMoney(trend.profit),
  }));
};

const getCompletedFinanceRequests = async (scope, range) => {
  const requests = await Request.find(buildCompletedFinanceQuery(scope, range))
    .populate('contactId', 'name phone email')
    .sort({ completedAt: -1, updatedAt: -1, createdAt: -1 })
    .lean();

  return requests.filter((request) => normalizeStatus(request.status) === 'completed');
};

const formatFinancialActivity = (request) => {
  const revenue = getRevenue(request);
  const expense = getExpense(request);
  const profit = getProfit(request);

  return {
    customerName: request.contactId?.name || 'Unknown Customer',
    requestTitle: request.title,
    revenue: roundMoney(revenue),
    expense: roundMoney(expense),
    profit: roundMoney(profit),
    status: request.paymentStatus,
    date: getFinanceDate(request),
  };
};

/**
 * GET /api/analytics/overview
 * Analytics and finance overview derived from real request data.
 */
exports.getOverview = async (req, res, next) => {
  try {
    const scope = await getRequestScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const range = getDateRange(req.query);
    const baseQuery = buildBaseQuery(scope);
    const requestQuery = {
      ...baseQuery,
      ...buildDateQuery('createdAt', range),
    };

    const [requests, completedFinancialRequests] = await Promise.all([
      Request.find(requestQuery).lean(),
      getCompletedFinanceRequests(scope, range),
    ]);

    const totalRequests = requests.length;
    const statusCounts = requests.reduce((counts, request) => {
      const status = normalizeStatus(request.status);

      if (status) {
        counts[status] = (counts[status] || 0) + 1;
      }

      return counts;
    }, {});

    const completedRequests = statusCounts.completed || 0;
    const pendingRequests = statusCounts.pending || 0;
    const inProgressRequests = statusCounts.in_progress || 0;
    const cancelledRequests = statusCounts.cancelled || 0;

    const financeTotals = completedFinancialRequests.reduce((totals, request) => {
      const revenue = getRevenue(request);
      const expense = getExpense(request);
      const profit = getProfit(request);

      totals.totalRevenue += revenue;
      totals.totalExpense += expense;
      totals.netProfit += profit;

      if (request.paymentStatus === 'pending') {
        totals.pendingRevenue += revenue;
      }

      if (request.paymentStatus === 'completed') {
        totals.paidRevenue += revenue;
      }

      return totals;
    }, {
      totalRevenue: 0,
      pendingRevenue: 0,
      paidRevenue: 0,
      totalExpense: 0,
      netProfit: 0,
    });

    const totalRevenue = roundMoney(financeTotals.totalRevenue);
    const pendingRevenue = roundMoney(financeTotals.pendingRevenue);
    const paidRevenue = roundMoney(financeTotals.paidRevenue);
    const totalExpense = roundMoney(financeTotals.totalExpense);
    const netProfit = roundMoney(financeTotals.netProfit);
    const profitMargin = getProfitMargin(netProfit, totalRevenue);

    const statusBreakdown = ['pending', 'in_progress', 'completed', 'cancelled'].map((status) => ({
      status,
      count: statusCounts[status] || 0,
      percent: getPercent(statusCounts[status] || 0, totalRequests),
    }));

    const serviceMap = completedFinancialRequests.reduce((services, request) => {
      const rawServiceName = request.title || request.category || 'Other';
      const serviceKey = normalizeServiceKey(rawServiceName);
      const revenue = getRevenue(request);
      const profit = getProfit(request);

      if (!services.has(serviceKey)) {
        services.set(serviceKey, {
          serviceName: formatServiceName(rawServiceName),
          requests: 0,
          revenue: 0,
          profit: 0,
        });
      }

      const service = services.get(serviceKey);
      service.requests += 1;
      service.revenue += revenue;
      service.profit += profit;

      return services;
    }, new Map());

    const topPerformingServices = Array.from(serviceMap.values())
      .map((service) => ({
        ...service,
        revenue: roundMoney(service.revenue),
        profit: roundMoney(service.profit),
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    const recentFinancialActivity = completedFinancialRequests
      .slice(0, 5)
      .map(formatFinancialActivity);

    res.status(200).json({
      success: true,
      data: {
        summary: {
          totalRequests,
          completedRequests,
          pendingRequests,
          inProgressRequests,
          cancelledRequests,
          totalRevenue,
          pendingRevenue,
          paidRevenue,
          totalExpense,
          netProfit,
          profitMargin,
        },
        requestAnalytics: {
          pendingPercent: getPercent(pendingRequests, totalRequests),
          inProgressPercent: getPercent(inProgressRequests, totalRequests),
          completedPercent: getPercent(completedRequests, totalRequests),
          cancelledPercent: getPercent(cancelledRequests, totalRequests),
        },
        financeOverview: {
          totalRevenue,
          totalExpense,
          netProfit,
        },
        monthlyTrend: buildMonthlyTrend(completedFinancialRequests, range),
        statusBreakdown,
        topPerformingServices,
        recentFinancialActivity,
        profitSummary: {
          revenue: totalRevenue,
          expense: totalExpense,
          profit: netProfit,
          profitMargin,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/analytics/recent-financial-activity
 * Full or paginated financial activity derived from completed requests.
 */
exports.getRecentFinancialActivity = async (req, res, next) => {
  try {
    const scope = await getRequestScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const page = Math.max(Number(req.query.page) || 1, 1);
    const hasLimit = req.query.limit !== undefined && req.query.limit !== '';
    const limit = hasLimit ? Math.min(Math.max(Number(req.query.limit) || 20, 1), 100) : null;
    const range = getDateRange(req.query);
    const completedFinancialRequests = await getCompletedFinanceRequests(scope, range);
    const total = completedFinancialRequests.length;
    const start = limit ? (page - 1) * limit : 0;
    const pagedRequests = limit
      ? completedFinancialRequests.slice(start, start + limit)
      : completedFinancialRequests;
    const activities = pagedRequests
      .map(formatFinancialActivity);

    res.status(200).json({
      success: true,
      data: {
        activities,
        total,
        page,
        limit,
      },
    });
  } catch (error) {
    next(error);
  }
};
