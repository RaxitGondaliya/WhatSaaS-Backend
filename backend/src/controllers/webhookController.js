const whatsappService = require('../services/whatsappService');

/**
 * Verifies the Meta webhook setup
 * GET /webhook
 */
exports.verifyWebhook = (req, res) => {
  const verifyToken = process.env.VERIFY_TOKEN;
  
  console.log('--- Webhook Debug ---');
  console.log('Loaded VERIFY_TOKEN:', verifyToken ? 'Exists' : 'Missing');
  console.log('---------------------');

  if (!verifyToken) {
    console.error('VERIFY_TOKEN not found in environment variables');
    return res.status(500).json({ success: false, message: 'Server configuration error' });
  }

  // Parse params from the webhook verification request
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Check if a token and mode were sent
  if (mode && token) {
    // Check the mode and token sent are correct
    if (mode === 'subscribe' && token === verifyToken) {
      // Respond with 200 OK and challenge token from the request
      console.log('WEBHOOK_VERIFIED');
      res.status(200).type('text/plain').send(challenge);
    } else {
      // Responds with '403 Forbidden' if verify tokens do not match
      res.sendStatus(403);
    }
  } else {
    // Return simple success response if accessed without Meta params
    res.status(200).send('Webhook endpoint is running');
  }
};

/**
 * Handles incoming webhook events
 * POST /webhook
 */
exports.handleWebhook = (req, res) => {
  const body = req.body;

  console.log(JSON.stringify(body, null, 2));
  res.sendStatus(200);

  // Check the Incoming webhook message
  // info on WhatsApp text message payload: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
  if (body.object === 'whatsapp_business_account') {
    // Process the payload asynchronously
    whatsappService.processIncomingMessage(body);
  }
};
