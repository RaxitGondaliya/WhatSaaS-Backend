const Notification = require('../models/Notification');
const NotificationPreference = require('../models/NotificationPreference');
const User = require('../models/User');

const PREFERENCE_FIELDS = [
  'newRequest',
  'whatsappRequest',
  'paymentPending',
  'lowWallet',
  'soundEnabled',
  'emailEnabled',
];

const setNoCacheHeaders = (res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
    'Surrogate-Control': 'no-store',
  });
};

const getNotificationScope = async (userId) => {
  const currentUser = await User.findById(userId);

  if (!currentUser) {
    return { errorStatus: 404, errorMessage: 'User not found' };
  }

  const owner = currentUser.businessId && currentUser.role !== 'owner'
    ? await User.findOne({ businessId: currentUser.businessId, role: 'owner' })
    : currentUser;

  return {
    currentUser,
    ownerId: owner?._id || currentUser._id,
    businessId: currentUser.businessId || null,
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

const buildScopedQuery = (scope, extra = {}) => ({
  ownerId: scope.ownerId,
  businessId: scope.businessId,
  ...extra,
});

const getOrCreatePreferences = async (scope) => {
  return NotificationPreference.findOneAndUpdate(
    buildScopedQuery(scope),
    { $setOnInsert: buildScopedQuery(scope) },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );
};

const formatPreferences = (preferences) => ({
  _id: preferences._id,
  ownerId: preferences.ownerId,
  businessId: preferences.businessId,
  newRequest: preferences.newRequest,
  whatsappRequest: preferences.whatsappRequest,
  paymentPending: preferences.paymentPending,
  lowWallet: preferences.lowWallet,
  soundEnabled: preferences.soundEnabled,
  emailEnabled: preferences.emailEnabled,
  createdAt: preferences.createdAt,
  updatedAt: preferences.updatedAt,
});

const formatNotification = (notification) => ({
  _id: notification._id,
  ownerId: notification.ownerId,
  businessId: notification.businessId,
  type: notification.type,
  title: notification.title,
  message: notification.message,
  referenceType: notification.referenceType,
  referenceId: notification.referenceId,
  isRead: notification.isRead,
  isCleared: notification.isCleared,
  createdAt: notification.createdAt,
});

exports.getPreferences = async (req, res, next) => {
  try {
    setNoCacheHeaders(res);

    const scope = await getNotificationScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const preferences = await getOrCreatePreferences(scope);

    res.status(200).json({
      success: true,
      preferences: formatPreferences(preferences),
    });
  } catch (error) {
    next(error);
  }
};

exports.updatePreferences = async (req, res, next) => {
  try {
    const scope = await getNotificationScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const updates = {};
    PREFERENCE_FIELDS.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = Boolean(req.body[field]);
      }
    });

    const preferences = await NotificationPreference.findOneAndUpdate(
      buildScopedQuery(scope),
      {
        $setOnInsert: buildScopedQuery(scope),
        $set: updates,
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({
      success: true,
      message: 'Notification preferences updated successfully',
      preferences: formatPreferences(preferences),
    });
  } catch (error) {
    next(error);
  }
};

exports.getNotifications = async (req, res, next) => {
  try {
    setNoCacheHeaders(res);

    const scope = await getNotificationScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const query = buildScopedQuery(scope, { isCleared: { $ne: true } });

    if (req.query.isRead !== undefined && req.query.isRead !== '') {
      query.isRead = req.query.isRead === true || req.query.isRead === 'true';
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(limit);

    res.status(200).json({
      success: true,
      count: notifications.length,
      notifications: notifications.map(formatNotification),
    });
  } catch (error) {
    next(error);
  }
};

exports.markNotificationRead = async (req, res, next) => {
  try {
    const scope = await getNotificationScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const notification = await Notification.findOneAndUpdate(
      buildScopedQuery(scope, { _id: req.params.id, isCleared: { $ne: true } }),
      { isRead: true },
      { new: true, runValidators: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Notification marked as read',
      notification: formatNotification(notification),
    });
  } catch (error) {
    next(error);
  }
};

exports.markAllRead = async (req, res, next) => {
  try {
    const scope = await getNotificationScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const result = await Notification.updateMany(
      buildScopedQuery(scope, { isRead: false, isCleared: { $ne: true } }),
      { isRead: true }
    );

    res.status(200).json({
      success: true,
      message: 'All notifications marked as read',
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    next(error);
  }
};

exports.clearReadNotifications = async (req, res, next) => {
  try {
    const scope = await getNotificationScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    await Notification.updateMany(
      buildScopedQuery(scope, { isRead: true, isCleared: { $ne: true } }),
      { isCleared: true }
    );

    res.status(200).json({
      success: true,
      message: 'Read notifications cleared',
    });
  } catch (error) {
    next(error);
  }
};

exports.createTestNotification = async (req, res, next) => {
  try {
    const scope = await getNotificationScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const notification = await Notification.create({
      ownerId: scope.ownerId,
      businessId: scope.businessId,
      type: 'system',
      title: req.body.title || 'Test Notification',
      message: req.body.message || 'This is a test notification for UI testing.',
      referenceType: req.body.referenceType || '',
      referenceId: req.body.referenceId || null,
    });

    res.status(201).json({
      success: true,
      message: 'Test notification created successfully',
      notification: formatNotification(notification),
    });
  } catch (error) {
    next(error);
  }
};
