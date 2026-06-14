const express = require('express');
const analyticsController = require('../controllers/analyticsController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

router.get('/overview', analyticsController.getOverview);
router.get('/recent-financial-activity', analyticsController.getRecentFinancialActivity);

module.exports = router;
