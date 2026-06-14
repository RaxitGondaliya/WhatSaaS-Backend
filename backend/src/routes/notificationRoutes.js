const express = require('express');
const notificationController = require('../controllers/notificationController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

const noCache = (req, res, next) => {
  delete req.headers['if-none-match'];
  delete req.headers['if-modified-since'];
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
    'Surrogate-Control': 'no-store',
  });
  next();
};

router.get('/preferences', noCache, notificationController.getPreferences);
router.put('/preferences', notificationController.updatePreferences);
router.get('/', noCache, notificationController.getNotifications);
router.delete('/clear-read', notificationController.clearReadNotifications);
router.put('/read-all', notificationController.markAllRead);
router.put('/:id/read', notificationController.markNotificationRead);
router.post('/test', notificationController.createTestNotification);

module.exports = router;
