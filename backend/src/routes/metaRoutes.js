const express = require('express');
const router = express.Router();
const metaController = require('../controllers/metaController');
const { protect } = require('../middleware/authMiddleware'); // Reusing existing auth

// POST /api/meta/onboarding/save
router.post('/onboarding/save', protect, metaController.saveOnboardingData);

// GET /api/meta/status
router.get('/status', protect, metaController.getStatus);

// POST /api/meta/disconnect
router.post('/disconnect', protect, metaController.disconnect);

module.exports = router;
