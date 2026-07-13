const mongoose = require('mongoose');
const BroadcastCampaign = require('../models/BroadcastCampaign');
const Contact = require('../models/Contact');
const User = require('../models/User');
const WhatsAppConfig = require('../models/WhatsAppConfig');
const whatsappService = require('../services/whatsappService');

const VALID_CAMPAIGN_TYPES = ['marketing', 'utility', 'reminder', 'custom'];
const VALID_MESSAGE_FORMATS = ['text', 'image', 'video', 'document'];
const VALID_RECIPIENTS_TYPES = ['all_contacts', 'contact_group', 'selected_contacts'];
const VALID_STATUSES = ['draft', 'scheduled', 'sent', 'failed', 'cancelled'];
const VALID_BUTTON_TYPES = ['url', 'phone', 'quick_reply'];

const normalizeText = (value) => {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim().toLowerCase();
};

const interpolateBroadcastText = (text, contact) => {
  if (!text) return '';
  
  const values = {
    customer_name: contact.name || '',
    customer_phone: contact.phone || '',
  };

  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, variableName) => {
    const key = variableName.toLowerCase();
    if (values[key] !== undefined) {
      return values[key];
    }
    // If the variable is not supported or missing, replace with empty string as per requirements
    return '';
  });
};

const normalizeEnumText = (value) => {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
};

const normalizeOptionalString = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildCreatedAtDateRange = (month, year) => {
  const parsedYear = Number.parseInt(year, 10);

  if (Number.isNaN(parsedYear)) {
    return null;
  }

  if (month !== undefined && month !== '') {
    const parsedMonth = Number.parseInt(month, 10);

    if (Number.isNaN(parsedMonth) || parsedMonth < 1 || parsedMonth > 12) {
      return null;
    }

    const start = new Date(parsedYear, parsedMonth - 1, 1);
    const end = new Date(parsedYear, parsedMonth, 1);

    return { start, end, query: { $gte: start, $lt: end } };
  }

  const start = new Date(parsedYear, 0, 1);
  const end = new Date(parsedYear + 1, 0, 1);

  return { start, end, query: { $gte: start, $lt: end } };
};

const normalizeStringArray = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
};

const normalizeButtons = (buttons) => {
  if (!Array.isArray(buttons)) {
    return [];
  }

  return buttons.map((button) => ({
    text: normalizeOptionalString(button?.text),
    type: VALID_BUTTON_TYPES.includes(normalizeText(button?.type))
      ? normalizeText(button.type)
      : 'quick_reply',
    value: normalizeOptionalString(button?.value),
  }));
};

const normalizeSelectedContacts = (selectedContacts) => (
  Array.isArray(selectedContacts) ? selectedContacts.filter(Boolean) : []
);

const applyRecipientRules = (campaign) => {
  if (campaign.recipientsType === 'all_contacts') {
    campaign.selectedContacts = [];
    campaign.contactGroup = '';
    return;
  }

  if (campaign.recipientsType === 'selected_contacts') {
    campaign.selectedContacts = normalizeSelectedContacts(campaign.selectedContacts);
    campaign.contactGroup = '';
    return;
  }

  if (campaign.recipientsType === 'contact_group') {
    campaign.selectedContacts = [];
    campaign.contactGroup = normalizeOptionalString(campaign.contactGroup);
  }
};

const applyMessageFormatRules = (campaign) => {
  if (campaign.messageFormat === 'text') {
    campaign.mediaUrl = '';
    campaign.mediaName = '';
  }
};

const getCampaignScope = async (userId) => {
  const currentUser = await User.findById(userId);

  if (!currentUser) {
    return { errorStatus: 404, errorMessage: 'User not found' };
  }

  if (!currentUser.businessId) {
    return {
      currentUser,
      businessId: null,
      ownerId: currentUser._id,
    };
  }

  const owner = currentUser.role === 'owner'
    ? currentUser
    : await User.findOne({ businessId: currentUser.businessId, role: 'owner' });

  return {
    currentUser,
    businessId: currentUser.businessId,
    ownerId: owner?._id || currentUser._id,
  };
};

const sendScopeError = (res, scope) => {
  if (!scope.errorStatus) {
    return false;
  }

  res.status(scope.errorStatus).json({
    success: false,
    message: scope.errorMessage,
  });
  return true;
};

const buildScopedQuery = (scope, extra = {}) => ({
  ownerId: scope.ownerId,
  businessId: scope.businessId,
  ...extra,
});

const buildContactQuery = (scope, extra = {}) => ({
  ownerId: scope.ownerId,
  businessId: scope.businessId,
  status: 'active',
  isDeleted: false,
  ...extra,
});

const validateCampaignInput = ({ campaignType, messageFormat, recipientsType, status }) => {
  if (campaignType !== undefined && !VALID_CAMPAIGN_TYPES.includes(campaignType)) {
    return 'Campaign type must be marketing, utility, reminder, or custom';
  }

  if (messageFormat !== undefined && !VALID_MESSAGE_FORMATS.includes(messageFormat)) {
    return 'Message format must be text, image, video, or document';
  }

  if (recipientsType !== undefined && !VALID_RECIPIENTS_TYPES.includes(recipientsType)) {
    return 'Recipients type must be all_contacts, contact_group, or selected_contacts';
  }

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return 'Status must be draft, scheduled, sent, or cancelled';
  }

  return null;
};

const calculateEstimatedRecipients = async (scope, campaign) => {
  if (campaign.recipientsType === 'selected_contacts') {
    return normalizeSelectedContacts(campaign.selectedContacts).length;
  }

  if (campaign.recipientsType === 'contact_group') {
    const contactGroup = normalizeOptionalString(campaign.contactGroup);

    if (!contactGroup) {
      return 0;
    }

    return Contact.countDocuments(buildContactQuery(scope, { tags: contactGroup }));
  }

  return Contact.countDocuments(buildContactQuery(scope));
};

const formatCampaign = (campaign) => ({
  _id: campaign._id,
  businessId: campaign.businessId,
  ownerId: campaign.ownerId,
  createdBy: campaign.createdBy,
  updatedBy: campaign.updatedBy,
  campaignName: campaign.campaignName,
  description: campaign.description,
  campaignType: campaign.campaignType,
  messageFormat: campaign.messageFormat,
  messageContent: campaign.messageContent,
  mediaUrl: campaign.mediaUrl,
  mediaName: campaign.mediaName,
  buttons: campaign.buttons,
  variables: campaign.variables,
  recipientsType: campaign.recipientsType,
  selectedContacts: campaign.selectedContacts,
  contactGroup: campaign.contactGroup,
  estimatedRecipients: campaign.estimatedRecipients,
  status: campaign.status,
  scheduleAt: campaign.scheduleAt,
  sentAt: campaign.sentAt,
  totalSent: campaign.totalSent,
  totalDelivered: campaign.totalDelivered,
  totalFailed: campaign.totalFailed,
  createdAt: campaign.createdAt,
  updatedAt: campaign.updatedAt,
});

const normalizeCampaignPayload = (body, existing = {}) => {
  const payload = {};
  const fields = [
    'campaignName',
    'description',
    'campaignType',
    'messageFormat',
    'messageContent',
    'mediaUrl',
    'mediaName',
    'buttons',
    'variables',
    'recipientsType',
    'selectedContacts',
    'contactGroup',
    'status',
    'scheduleAt',
  ];

  fields.forEach((field) => {
    if (body[field] !== undefined) {
      payload[field] = body[field];
    }
  });

  if (payload.campaignType !== undefined) payload.campaignType = normalizeEnumText(payload.campaignType);
  if (payload.messageFormat !== undefined) payload.messageFormat = normalizeEnumText(payload.messageFormat);
  if (payload.recipientsType !== undefined) payload.recipientsType = normalizeEnumText(payload.recipientsType);
  if (payload.status !== undefined) payload.status = normalizeEnumText(payload.status);
  if (payload.buttons !== undefined) payload.buttons = normalizeButtons(payload.buttons);
  if (payload.variables !== undefined) payload.variables = normalizeStringArray(payload.variables);
  if (payload.selectedContacts !== undefined) {
    payload.selectedContacts = normalizeSelectedContacts(payload.selectedContacts);
  }
  if (payload.contactGroup !== undefined) payload.contactGroup = normalizeOptionalString(payload.contactGroup);
  if (payload.scheduleAt !== undefined) payload.scheduleAt = payload.scheduleAt ? new Date(payload.scheduleAt) : null;

  const merged = { ...existing, ...payload };
  return { payload, merged };
};

/**
 * GET /api/broadcast-campaigns
 * Return all campaigns for current owner/business scope.
 */
exports.getCampaigns = async (req, res, next) => {
  try {
    const scope = await getCampaignScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const { status, campaignType, search, month, year } = req.query;
    const query = buildScopedQuery(scope);

    if (status) query.status = normalizeText(status);
    if (campaignType) query.campaignType = normalizeText(campaignType);

    if (month && !year) {
      return res.status(400).json({
        success: false,
        message: 'Year is required when month filter is provided',
      });
    }

    if (year) {
      const createdAtRange = buildCreatedAtDateRange(month, year);

      if (!createdAtRange) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid month and year filter',
        });
      }

      if (createdAtRange) {
        query.createdAt = createdAtRange.query;
      }
    }

    if (search) {
      const searchRegex = new RegExp(escapeRegex(search), 'i');
      query.$or = [
        { campaignName: searchRegex },
        { description: searchRegex },
        { messageContent: searchRegex },
        { campaignType: searchRegex },
      ];
    }

    const campaigns = await BroadcastCampaign.find(query)
      .populate('selectedContacts', 'name phone email tags status')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: campaigns.length,
      campaigns: campaigns.map(formatCampaign),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/broadcast-campaigns
 * Create campaign draft or scheduled campaign metadata.
 */
exports.createCampaign = async (req, res, next) => {
  try {
    const scope = await getCampaignScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const {
      campaignName,
      description = '',
      campaignType = 'marketing',
      messageFormat = 'text',
      messageContent = '',
      mediaUrl = '',
      mediaName = '',
      buttons = [],
      variables = [],
      recipientsType = 'all_contacts',
      selectedContacts = [],
      contactGroup = '',
      status = 'draft',
      scheduleAt = null,
    } = req.body;

    const normalizedCampaignType = normalizeEnumText(campaignType) || 'marketing';
    const normalizedMessageFormat = normalizeEnumText(messageFormat) || 'text';
    const normalizedRecipientsType = normalizeEnumText(recipientsType) || 'all_contacts';
    const normalizedStatus = normalizeEnumText(status) || 'draft';

    if (!normalizeOptionalString(campaignName)) {
      return res.status(400).json({
        success: false,
        message: 'Campaign name is required',
      });
    }

    const validationError = validateCampaignInput({
      campaignType: normalizedCampaignType,
      messageFormat: normalizedMessageFormat,
      recipientsType: normalizedRecipientsType,
      status: normalizedStatus,
    });

    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }

    const campaignData = {
      businessId: scope.businessId,
      ownerId: scope.ownerId,
      createdBy: scope.currentUser._id,
      updatedBy: scope.currentUser._id,
      campaignName,
      description,
      campaignType: normalizedCampaignType,
      messageFormat: normalizedMessageFormat,
      messageContent: normalizeOptionalString(messageContent),
      mediaUrl,
      mediaName,
      buttons: normalizeButtons(buttons),
      variables: normalizeStringArray(variables),
      recipientsType: normalizedRecipientsType,
      selectedContacts: normalizeSelectedContacts(selectedContacts),
      contactGroup: normalizeOptionalString(contactGroup),
      status: normalizedStatus,
      scheduleAt: scheduleAt ? new Date(scheduleAt) : null,
    };

    applyRecipientRules(campaignData);
    applyMessageFormatRules(campaignData);

    if (campaignData.messageFormat !== 'text') {
      if (campaignData.mediaUrl && (campaignData.mediaUrl.startsWith('data:') || !campaignData.mediaUrl.startsWith('http'))) {
        return res.status(400).json({
          success: false,
          message: 'Base64 and invalid URLs are not supported. Please use a public image URL (e.g., Cloudinary).'
        });
      }
    }

    if (campaignData.recipientsType === 'contact_group' && !campaignData.contactGroup) {
      return res.status(400).json({
        success: false,
        message: 'Contact group is required when recipients type is contact_group',
      });
    }

    campaignData.estimatedRecipients = await calculateEstimatedRecipients(scope, campaignData);

    const campaign = await BroadcastCampaign.create(campaignData);

    res.status(201).json({
      success: true,
      message: 'Broadcast campaign created successfully',
      campaign: formatCampaign(campaign),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/broadcast-campaigns/:id
 * Get single campaign.
 */
exports.getCampaign = async (req, res, next) => {
  try {
    const scope = await getCampaignScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const campaign = await BroadcastCampaign.findOne(buildScopedQuery(scope, { _id: req.params.id }))
      .populate('selectedContacts', 'name phone email tags status');

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Broadcast campaign not found',
      });
    }

    res.status(200).json({
      success: true,
      campaign: formatCampaign(campaign),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/broadcast-campaigns/:id
 * Update campaign data.
 */
exports.updateCampaign = async (req, res, next) => {
  try {
    const scope = await getCampaignScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const campaign = await BroadcastCampaign.findOne(buildScopedQuery(scope, { _id: req.params.id }));

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Broadcast campaign not found',
      });
    }

    const { payload, merged } = normalizeCampaignPayload(req.body, campaign.toObject());

    if (payload.campaignName !== undefined && !normalizeOptionalString(payload.campaignName)) {
      return res.status(400).json({
        success: false,
        message: 'Campaign name is required',
      });
    }

    if (payload.messageContent !== undefined && !normalizeOptionalString(payload.messageContent)) {
      return res.status(400).json({
        success: false,
        message: 'Message content is required',
      });
    }

    const validationError = validateCampaignInput({
      campaignType: payload.campaignType,
      messageFormat: payload.messageFormat,
      recipientsType: payload.recipientsType,
      status: payload.status,
    });

    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }

    Object.assign(campaign, payload);
    applyRecipientRules(campaign);
    applyMessageFormatRules(campaign);

    if (campaign.messageFormat !== 'text') {
      if (campaign.mediaUrl && (campaign.mediaUrl.startsWith('data:') || !campaign.mediaUrl.startsWith('http'))) {
        return res.status(400).json({
          success: false,
          message: 'Base64 and invalid URLs are not supported. Please use a public image URL (e.g., Cloudinary).'
        });
      }
    }

    if (campaign.recipientsType === 'contact_group' && !campaign.contactGroup) {
      return res.status(400).json({
        success: false,
        message: 'Contact group is required when recipients type is contact_group',
      });
    }

    campaign.updatedBy = scope.currentUser._id;
    campaign.estimatedRecipients = await calculateEstimatedRecipients(scope, campaign);

    await campaign.save();
    await campaign.populate('selectedContacts', 'name phone email tags status');

    res.status(200).json({
      success: true,
      message: 'Broadcast campaign updated successfully',
      campaign: formatCampaign(campaign),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/broadcast-campaigns/:id
 * Delete campaign.
 */
exports.deleteCampaign = async (req, res, next) => {
  try {
    const scope = await getCampaignScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const campaign = await BroadcastCampaign.findOne(buildScopedQuery(scope, { _id: req.params.id }));

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Broadcast campaign not found',
      });
    }

    await campaign.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Broadcast campaign deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/broadcast-campaigns/:id/schedule
 * Schedule a campaign without sending it.
 */
exports.scheduleCampaign = async (req, res, next) => {
  try {
    const scope = await getCampaignScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const campaign = await BroadcastCampaign.findOne(buildScopedQuery(scope, { _id: req.params.id }));

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Broadcast campaign not found',
      });
    }

    if (['scheduled', 'processing', 'sent'].includes(campaign.status)) {
      return res.status(409).json({
        success: false,
        message: 'This campaign has already been scheduled.'
      });
    }

    if (campaign.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Cannot schedule a cancelled campaign.',
      });
    }

    if (!req.body.scheduleAt) {
      return res.status(400).json({
        success: false,
        message: 'Schedule date is required',
      });
    }

    const scheduleAt = new Date(req.body.scheduleAt);
    if (Number.isNaN(scheduleAt.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid schedule date',
      });
    }

    const estimatedRecipients = await calculateEstimatedRecipients(scope, campaign);

    // Atomically update only if the status hasn't changed (prevents race conditions from double clicks)
    const updatedCampaign = await BroadcastCampaign.findOneAndUpdate(
      buildScopedQuery(scope, { _id: req.params.id, status: campaign.status }),
      {
        $set: {
          status: 'scheduled',
          scheduleAt: scheduleAt,
          updatedBy: scope.currentUser._id,
          estimatedRecipients: estimatedRecipients
        }
      },
      { new: true }
    );

    if (!updatedCampaign) {
      return res.status(409).json({
        success: false,
        message: 'This campaign has already been scheduled.'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Broadcast campaign scheduled successfully',
      campaign: formatCampaign(updatedCampaign),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/broadcast-campaigns/:id/save-draft
 * Save campaign as draft.
 */
exports.saveDraft = async (req, res, next) => {
  try {
    const scope = await getCampaignScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const campaign = await BroadcastCampaign.findOne(buildScopedQuery(scope, { _id: req.params.id }));

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Broadcast campaign not found',
      });
    }

    campaign.status = 'draft';
    campaign.updatedBy = scope.currentUser._id;
    await campaign.save();

    res.status(200).json({
      success: true,
      message: 'Broadcast campaign saved as draft',
      campaign: formatCampaign(campaign),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/broadcast-campaigns/:id/cancel
 * Cancel campaign.
 */
exports.cancelCampaign = async (req, res, next) => {
  try {
    const scope = await getCampaignScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const campaign = await BroadcastCampaign.findOne(buildScopedQuery(scope, { _id: req.params.id }));

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Broadcast campaign not found',
      });
    }

    campaign.status = 'cancelled';
    campaign.updatedBy = scope.currentUser._id;
    await campaign.save();

    res.status(200).json({
      success: true,
      message: 'Broadcast campaign cancelled successfully',
      campaign: formatCampaign(campaign),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/broadcast-campaigns/:id/send
 * Send the broadcast campaign
 */
exports.sendCampaign = async (req, res, next) => {
  try {
    const scope = await getCampaignScope(req.user.id);
    if (sendScopeError(res, scope)) return;

    const campaign = await BroadcastCampaign.findOne(buildScopedQuery(scope, { _id: req.params.id }));

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Broadcast campaign not found' });
    }

    if (campaign.status === 'sent' || campaign.status === 'cancelled') {
      return res.status(400).json({ success: false, message: `Cannot send campaign with status: ${campaign.status}` });
    }

    if (!campaign.messageContent && campaign.messageFormat === 'text') {
      return res.status(400).json({ success: false, message: 'Message content is required to send a text campaign' });
    }

    if (campaign.messageFormat !== 'text') {
      if (!campaign.mediaUrl) {
        return res.status(400).json({ success: false, message: 'Media URL is required to send a media campaign' });
      }
      if (campaign.mediaUrl.startsWith('data:') || !campaign.mediaUrl.startsWith('http')) {
        return res.status(400).json({ success: false, message: 'Base64 and invalid URLs are not supported. Please use a public image URL (e.g., Cloudinary).' });
      }
    }

    // Load WhatsAppConfig
    const whatsappConfig = await WhatsAppConfig.findOne({ businessId: scope.businessId });
    if (!whatsappConfig || !whatsappConfig.accessToken || !whatsappConfig.phoneNumberId) {
      return res.status(400).json({ success: false, message: 'WhatsApp configuration (access token or phone number ID) is missing for this business' });
    }

    // Determine recipients
    let recipients = [];
    if (campaign.recipientsType === 'all_contacts') {
      recipients = await Contact.find(buildContactQuery(scope));
    } else if (campaign.recipientsType === 'contact_group') {
      const contactGroup = normalizeOptionalString(campaign.contactGroup);
      if (contactGroup) {
        recipients = await Contact.find(buildContactQuery(scope, { tags: contactGroup }));
      }
    } else if (campaign.recipientsType === 'selected_contacts') {
      console.log('\n--- DEBUG: BROADCAST RECIPIENT LOADING ---');
      console.log('campaign.selectedContacts (raw from DB):', campaign.selectedContacts);

      // Verify ObjectId conversion
      const selectedContactIds = (campaign.selectedContacts || []).map(id => {
        try {
          return new mongoose.Types.ObjectId(id.toString());
        } catch (e) {
          console.error(`[Error] Invalid ObjectId format: ${id}`);
          return null;
        }
      }).filter(Boolean);

      console.log(`Number of IDs received: ${selectedContactIds.length}`);

      // Query MongoDB using all selected contact IDs
      const query = buildContactQuery(scope, { _id: { $in: selectedContactIds } });
      recipients = await Contact.find(query);

      console.log(`Contacts Loaded: ${recipients.length}`);
      recipients.forEach((contact, idx) => {
        console.log(`${idx + 1}.\nName: ${contact.name}\nPhone: ${contact.phone}\n_id: ${contact._id}`);
      });

      // Verify no filter is removing contacts
      if (selectedContactIds.length !== recipients.length) {
        console.log(`\n[WARNING] Mismatch detected: Selected (${selectedContactIds.length}) vs Loaded (${recipients.length})`);
        console.log('This means some selected contacts were filtered out by buildContactQuery (e.g. status != active, isDeleted = true) or deleted.');
      } else {
        console.log('\nAll selected contacts successfully loaded.');
      }
      console.log('------------------------------------------\n');
    }

    if (recipients.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid recipients found for this campaign' });
    }

    console.log('\n--- Broadcast Recipient Resolution ---');
    console.log(`Total Recipients Loaded: ${recipients.length}`);
    recipients.forEach((r, idx) => {
      console.log(`[${idx + 1}] ID: ${r._id || r.id}, Name: ${r.name || 'Unknown'}, Phone: ${r.phone || 'Unknown'}`);
    });

    // Remove duplicates based on phone number
    const uniquePhoneNumbers = new Set();
    const uniqueRecipients = [];

    for (const contact of recipients) {
      if (contact && contact.phone) {
        if (!uniquePhoneNumbers.has(contact.phone)) {
          uniquePhoneNumbers.add(contact.phone);
          uniqueRecipients.push(contact);
        } else {
          console.log(`[Duplicate Filter] Skipping duplicate phone number: ${contact.phone} for contact ID: ${contact._id || contact.id}`);
        }
      } else {
        uniqueRecipients.push(contact);
      }
    }

    console.log(`Unique Recipients Count: ${uniqueRecipients.length}`);
    console.log('--------------------------------------\n');

    // Convert message format to replyData format expected by whatsappService
    let replyData = {};

    if (campaign.messageFormat === 'image') {
      replyData = {
        type: 'Image',
        imageUrl: campaign.mediaUrl,
        caption: campaign.messageContent,
        text: campaign.messageContent,
      };
    } else if (campaign.messageFormat === 'video') {
      replyData = {
        type: 'Video',
        videoUrl: campaign.mediaUrl,
        caption: campaign.messageContent,
        text: campaign.messageContent,
      };
    } else if (campaign.messageFormat === 'document') {
      replyData = {
        type: 'Document',
        documentUrl: campaign.mediaUrl,
        documentName: campaign.mediaName || 'Document',
        caption: campaign.messageContent,
        text: campaign.messageContent,
      };
    } else {
      replyData = {
        type: 'Text',
        text: campaign.messageContent,
      };
    }

    const replyButtons = (campaign.buttons || []).map((b, i) => ({
      buttonId: `broadcast_${campaign._id}_btn_${i}`,
      text: b.text
    }));

    if (replyButtons.length > 0) {
      replyData.buttons = replyButtons;
    }

    let sent = 0;
    let failed = 0;
    let pending = 0;
    let errors = [];

    for (const contact of uniqueRecipients) {
      if (!contact.phone) {
        failed++;
        errors.push({ phone: 'unknown', error: 'Contact has no phone number' });
        continue;
      }

      console.log(`Sending to Recipient Name: ${contact.name || 'Unknown'}, Recipient Phone: ${contact.phone}`);

      // Dynamic Variable Replacement
      const personalizedReplyData = {
        ...replyData,
        text: interpolateBroadcastText(replyData.text, contact),
        caption: interpolateBroadcastText(replyData.caption, contact)
      };

      try {
        const response = await whatsappService.sendMessage(
          contact.phone,
          personalizedReplyData,
          whatsappConfig.phoneNumberId,
          whatsappConfig.accessToken,
          true // throwError
        );

        if (response && response.messages && response.messages.length > 0) {
          sent++;
        } else {
          failed++;
          errors.push({ phone: contact.phone, error: 'Failed to send WhatsApp reply, no message ID returned' });
        }
      } catch (err) {
        console.error(`Failed to send broadcast to ${contact.phone}:`, err.message);
        failed++;
        
        let errorMessage = err.message;
        
        // Detailed Meta API error tracking
        if (err.response && err.response.data && err.response.data.error) {
          const metaError = err.response.data.error;
          console.error(`Meta API Error for ${contact.phone}:`, JSON.stringify(metaError));
          
          const metaMsg = (metaError.message || '').toLowerCase();
          const metaCode = metaError.code;

          if (metaCode === 131031 || metaCode === 131030 || metaMsg.includes('test recipient') || metaMsg.includes('allowed list')) {
             errorMessage = "This recipient is not registered as a Meta test recipient.";
          } else if (metaCode === 131047 || metaMsg.includes('24 hours') || metaMsg.includes('outside the allowed window') || metaMsg.includes('template')) {
             errorMessage = "Marketing messages require an approved WhatsApp Template.";
          } else {
             errorMessage = metaError.message || JSON.stringify(metaError);
          }
        }
        
        errors.push({ phone: contact.phone, error: errorMessage });
      }
    }

    // Update campaign metrics
    campaign.status = sent > 0 ? 'sent' : 'failed';
    campaign.sentAt = new Date();
    campaign.totalSent = sent;
    campaign.totalFailed = failed;
    campaign.totalDelivered = 0;
    
    if (sent === 0 && errors.length > 0) {
      campaign.failureReason = errors[0].error;
    }
    
    await campaign.save();

    if (sent === 0 && failed > 0) {
      return res.status(400).json({
        success: false,
        message: errors[0].error,
        campaignId: campaign._id,
        status: campaign.status,
        statistics: {
          totalRecipients: uniqueRecipients.length,
          sent,
          failed
        },
        errors
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Broadcast campaign sent successfully.',
      campaignId: campaign._id,
      status: campaign.status,
      statistics: {
        totalRecipients: uniqueRecipients.length,
        sent,
        failed
      },
      errors
    });

  } catch (error) {
    next(error);
  }
};
