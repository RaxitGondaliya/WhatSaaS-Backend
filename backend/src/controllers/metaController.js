const WhatsAppConfig = require('../models/WhatsAppConfig');
const MetaIntegration = require('../models/MetaIntegration');
const Business = require('../models/Business');
const metaGraphService = require('../services/metaGraphService');

/**
 * GET /api/meta/connect
 * Generates the Facebook OAuth URL for backend-driven Meta login.
 */
exports.connect = (req, res) => {
  try {
    const appId = process.env.META_APP_ID;
    const configId = process.env.META_CONFIG_ID; // Used for Embedded Signup specific configurations
    const userId = req.user.id;

    if (!appId) {
      return res.status(500).json({ success: false, message: 'Server missing META_APP_ID' });
    }

    // Dynamic redirect URI (handles local vs render transparently if trust proxy is on)
    const backendUrl = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
    const redirectUri = `${backendUrl}/api/meta/callback`;

    // Construct the Facebook OAuth Dialog URL
    let url = `https://www.facebook.com/v22.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${userId}&response_type=code`;

    // Add scopes
    const scopes = ['whatsapp_business_management', 'whatsapp_business_messaging'];
    url += `&scope=${encodeURIComponent(scopes.join(','))}`;

    // If using the official WhatsApp Embedded Signup feature, config_id is often required:
    if (configId) {
      url += `&config_id=${configId}`;
    }

    res.status(200).json({
      success: true,
      url: url,
    });
  } catch (error) {
    console.error('[MetaController] Error generating connect URL:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

/**
 * GET /api/meta/callback
 * Handles the redirect back from Facebook after the user logs in.
 */
exports.callback = async (req, res) => {
  try {
    const { code, state, error, error_reason, error_description } = req.query;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    
    // If user cancelled or Meta threw an error
    if (error) {
      console.error('[MetaController] OAuth Error from Meta:', error_description);
      return res.redirect(`${frontendUrl}/dashboard/settings?meta=error&reason=${encodeURIComponent(error_description || 'User cancelled')}`);
    }

    if (!code || !state) {
      return res.redirect(`${frontendUrl}/dashboard/settings?meta=error&reason=Missing+code+or+state`);
    }

    const userId = state; // We passed the userId as the state param
    
    const backendUrl = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
    const redirectUri = `${backendUrl}/api/meta/callback`;

    // 1. Exchange the code for an access token
    const accessToken = await metaGraphService.exchangeCodeForToken(code, redirectUri);

    if (!accessToken) {
      return res.redirect(`${frontendUrl}/dashboard/settings?meta=error&reason=Token+Exchange+Failed`);
    }

    // 2. Fetch WABA and Phone Details from Meta Graph API
    const waDetails = await metaGraphService.getWhatsAppBusinessDetails(accessToken);

    if (!waDetails) {
      return res.redirect(`${frontendUrl}/dashboard/settings?meta=error&reason=Could+Not+Fetch+Business+Details`);
    }

    // 3. Ensure a Business Profile exists
    let business = await Business.findOne({ ownerId: userId });
    if (!business) {
      business = await Business.create({
        ownerId: userId,
        businessName: 'My WhatsApp Business',
        ownerName: 'SaaS Client',
        businessCategory: 'Other',
        whatsappNumber: waDetails.displayPhoneNumber || 'Pending',
        usageType: 'services'
      });
    }

    // 4. Save/Update MetaIntegration
    let metaIntegration = await MetaIntegration.findOne({ ownerId: userId });
    if (!metaIntegration) {
      metaIntegration = await MetaIntegration.create({
        ownerId: userId,
        businessId: business._id,
        systemUserAccessToken: accessToken,
        metaAccountId: waDetails.metaAccountId,
        status: 'active'
      });
    } else {
      metaIntegration.systemUserAccessToken = accessToken;
      metaIntegration.metaAccountId = waDetails.metaAccountId;
      metaIntegration.status = 'active';
      await metaIntegration.save();
    }

    // 5. Save/Update WhatsAppConfig
    let waConfig = await WhatsAppConfig.findOne({ ownerId: userId });
    if (!waConfig) {
      waConfig = await WhatsAppConfig.create({
        ownerId: userId,
        businessId: business._id,
        phoneNumberId: waDetails.phoneNumberId,
        wabaId: waDetails.wabaId,
        displayPhoneNumber: waDetails.displayPhoneNumber,
        accessToken: accessToken,
        chatbotEnabled: true
      });
    } else {
      waConfig.phoneNumberId = waDetails.phoneNumberId;
      waConfig.wabaId = waDetails.wabaId;
      waConfig.displayPhoneNumber = waDetails.displayPhoneNumber;
      waConfig.accessToken = accessToken;
      waConfig.chatbotEnabled = true;
      await waConfig.save();
    }

    // Update business profile with display number if needed
    if (business.whatsappNumber === 'Pending' || !business.whatsappNumber) {
      business.whatsappNumber = waDetails.displayPhoneNumber;
      await business.save();
    }

    // Successfully connected! Redirect to frontend
    res.redirect(`${frontendUrl}/dashboard/settings?meta=success`);

  } catch (err) {
    console.error('[MetaController] Error in callback:', err);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/dashboard/settings?meta=error&reason=Internal+Server+Error`);
  }
};

/**
 * Handle incoming payload from frontend Meta Embedded Signup popup
 */
exports.saveOnboardingData = async (req, res) => {
  try {
    const { accessToken, externalBusinessId } = req.body;
    const userId = req.user.id; // From authMiddleware

    if (!accessToken) {
      return res.status(400).json({ success: false, message: 'Missing Meta access token' });
    }

    // 1. Get the business profile for this user
    let business = await Business.findOne({ ownerId: userId });
    if (!business) {
      // If no business exists yet, create a default one to attach the WA config to
      business = await Business.create({
        ownerId: userId,
        businessName: 'My WhatsApp Business',
        ownerName: req.user.fullName || 'SaaS Client',
        businessCategory: 'Other',
        whatsappNumber: 'Pending',
        usageType: 'services'
      });
    }

    // 2. Exchange for long-lived token (Optional/Best Practice)
    const longLivedToken = await metaGraphService.getLongLivedToken(accessToken);

    // 3. Fetch WABA and Phone Details from Meta Graph API
    const waDetails = await metaGraphService.getWhatsAppBusinessDetails(longLivedToken);

    if (!waDetails) {
      return res.status(400).json({ 
        success: false, 
        message: 'Could not fetch WhatsApp Business details. Ensure you completed the Meta setup correctly.' 
      });
    }

    // 4. Save/Update MetaIntegration
    let metaIntegration = await MetaIntegration.findOne({ ownerId: userId });
    if (!metaIntegration) {
      metaIntegration = await MetaIntegration.create({
        ownerId: userId,
        businessId: business._id,
        systemUserAccessToken: longLivedToken,
        metaAccountId: waDetails.metaAccountId,
        status: 'active'
      });
    } else {
      metaIntegration.systemUserAccessToken = longLivedToken;
      metaIntegration.metaAccountId = waDetails.metaAccountId;
      metaIntegration.status = 'active';
      await metaIntegration.save();
    }

    // 5. Save/Update WhatsAppConfig
    let waConfig = await WhatsAppConfig.findOne({ ownerId: userId });
    if (!waConfig) {
      waConfig = await WhatsAppConfig.create({
        ownerId: userId,
        businessId: business._id,
        phoneNumberId: waDetails.phoneNumberId,
        wabaId: waDetails.wabaId,
        displayPhoneNumber: waDetails.displayPhoneNumber,
        accessToken: longLivedToken,
        chatbotEnabled: true
      });
    } else {
      waConfig.phoneNumberId = waDetails.phoneNumberId;
      waConfig.wabaId = waDetails.wabaId;
      waConfig.displayPhoneNumber = waDetails.displayPhoneNumber;
      waConfig.accessToken = longLivedToken;
      waConfig.chatbotEnabled = true;
      await waConfig.save();
    }

    // Update business profile with display number if needed
    if (business.whatsappNumber === 'Pending' || !business.whatsappNumber) {
      business.whatsappNumber = waDetails.displayPhoneNumber;
      await business.save();
    }

    res.status(200).json({
      success: true,
      message: 'WhatsApp Business connected successfully',
      data: {
        displayPhoneNumber: waConfig.displayPhoneNumber,
        wabaId: waConfig.wabaId,
        phoneNumberId: waConfig.phoneNumberId
      }
    });

  } catch (error) {
    console.error('[MetaController] Error saving onboarding data:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

/**
 * Get current WhatsApp connection status
 */
exports.getStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const waConfig = await WhatsAppConfig.findOne({ ownerId: userId });
    const metaIntegration = await MetaIntegration.findOne({ ownerId: userId });

    if (!waConfig || !metaIntegration || metaIntegration.status !== 'active') {
      return res.status(200).json({
        success: true,
        data: { connected: false }
      });
    }

    res.status(200).json({
      success: true,
      data: {
        connected: true,
        displayPhoneNumber: waConfig.displayPhoneNumber,
        wabaId: waConfig.wabaId,
        phoneNumberId: waConfig.phoneNumberId,
        chatbotEnabled: waConfig.chatbotEnabled
      }
    });

  } catch (error) {
    console.error('[MetaController] Error getting status:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

/**
 * Disconnect WhatsApp account
 */
exports.disconnect = async (req, res) => {
  try {
    const userId = req.user.id;

    await WhatsAppConfig.findOneAndDelete({ ownerId: userId });
    
    // We update status instead of deleting so we keep history
    await MetaIntegration.findOneAndUpdate(
      { ownerId: userId }, 
      { status: 'disconnected', systemUserAccessToken: null }
    );

    res.status(200).json({
      success: true,
      message: 'WhatsApp account disconnected successfully'
    });

  } catch (error) {
    console.error('[MetaController] Error disconnecting WhatsApp:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};
