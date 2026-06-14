const express = require('express');
const reportsController = require('../controllers/reportsController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

router.get('/summary', reportsController.getSummary);
router.get('/requests', reportsController.getRequestsReport);
router.get('/broadcasts', reportsController.getBroadcastsReport);
router.get('/contacts', reportsController.getContactsReport);
router.get('/chatbot', reportsController.getChatbotReport);
router.get('/payments', reportsController.getPaymentsReport);

module.exports = router;
