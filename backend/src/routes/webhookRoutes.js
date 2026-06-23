const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

// GET /webhook - Verification endpoint for Meta
router.get('/', webhookController.verifyWebhook);

// POST /webhook - Endpoint to receive messages and events from Meta
router.post('/', webhookController.handleWebhook);

module.exports = router;
