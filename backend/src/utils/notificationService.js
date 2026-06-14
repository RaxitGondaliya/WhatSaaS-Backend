const Notification = require('../models/Notification');
const NotificationPreference = require('../models/NotificationPreference');

const getOrCreatePreferences = async (scope) => {
  return NotificationPreference.findOneAndUpdate(
    {
      ownerId: scope.ownerId,
      businessId: scope.businessId || null,
    },
    {
      $setOnInsert: {
        ownerId: scope.ownerId,
        businessId: scope.businessId || null,
      },
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );
};

const createRequestNotification = async ({ scope, request, customerName, source = 'manual' }) => {
  const preferences = await getOrCreatePreferences(scope);
  const isWhatsappRequest = source === 'whatsapp';
  const isEnabled = isWhatsappRequest ? preferences.whatsappRequest : preferences.newRequest;

  if (!isEnabled) {
    return null;
  }

  return Notification.create({
    ownerId: scope.ownerId,
    businessId: scope.businessId || null,
    type: isWhatsappRequest ? 'whatsapp_request' : 'new_request',
    title: isWhatsappRequest ? 'New WhatsApp Request' : 'New Request Created',
    message: `New request from ${customerName || 'Unknown Customer'}`,
    referenceType: 'request',
    referenceId: request._id,
  });
};

module.exports = {
  createRequestNotification,
};
