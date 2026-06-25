const express = require('express');
const router = express.Router();
const metaController = require('../controllers/metaController');
const { protect } = require('../middleware/authMiddleware'); // Reusing existing auth

// GET /api/meta/connect
// Returns the OAuth URL for the frontend to redirect the user to
router.get('/connect', protect, metaController.connect);

// GET /api/meta/callback
// Handles the redirect from Facebook (receives the 'code')
// Notice it is NOT protected by standard JWT auth, because Facebook calls this directly via redirect.
// We will identify the user via the 'state' query parameter.
router.get('/callback', metaController.callback);

// POST /api/meta/onboarding/save (Legacy/Embedded SDK payload support)
router.post('/onboarding/save', protect, metaController.saveOnboardingData);

// GET /api/meta/status
router.get('/status', protect, metaController.getStatus);

// POST /api/meta/disconnect
router.post('/disconnect', protect, metaController.disconnect);

module.exports = router;
