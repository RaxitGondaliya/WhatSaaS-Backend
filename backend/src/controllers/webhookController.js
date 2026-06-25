const whatsappService = require('../services/whatsappService');

/**
 * Verifies the Meta webhook setup
 * GET /webhook
 */
exports.verifyWebhook = (req, res) => {
  try {
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
        return res.status(200).type('text/plain').send(challenge);
      } else {
        // Responds with '403 Forbidden' if verify tokens do not match
        return res.sendStatus(403);
      }
    } else {
      // Return simple success response if accessed without Meta params
      return res.status(200).send('Webhook endpoint is running');
    }
  } catch (error) {
    console.error('Error verifying webhook:', error);
    res.status(500).send('Internal Server Error');
  }
};

/**
 * Handles incoming webhook events
 * POST /webhook
 */
exports.handleWebhook = (req, res) => {
  try {
    const body = req.body;

    // Acknowledge receipt to Meta immediately
    res.sendStatus(200);

    // Check the Incoming webhook message
    if (body.object === 'whatsapp_business_account') {
      // Process the payload asynchronously to avoid blocking
      whatsappService.processIncomingMessage(body).catch(err => {
        console.error('Unhandled error processing WhatsApp message:', err);
      });
    } else {
      // Return a '404 Not Found' if event is not from a WhatsApp API
      res.sendStatus(404);
    }
  } catch (error) {
    console.error('Error in webhook handler:', error);
    // Even if there's an error, we should ideally respond 200 to prevent Meta from retrying, 
    // but if it errors before sendStatus(200), we should return 500.
    if (!res.headersSent) {
      res.sendStatus(500);
    }
  }
};
