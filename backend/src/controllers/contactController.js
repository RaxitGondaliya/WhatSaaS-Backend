const Contact = require('../models/Contact');
const User = require('../models/User');
const { normalizePhone } = require('../utils/phoneUtils');

const VALID_STATUSES = ['active', 'inactive', 'blocked'];
const VALID_SOURCES = ['manual', 'import', 'whatsapp', 'chatbot'];

const getCurrentUser = async (userId) => {
  return User.findById(userId);
};

const getContactScope = async (user) => {
  if (!user.businessId) {
    return {
      ownerId: user._id,
      businessId: null,
    };
  }

  const owner = user.role === 'owner'
    ? user
    : await User.findOne({ businessId: user.businessId, role: 'owner' });

  return {
    ownerId: owner?._id || user._id,
    businessId: user.businessId,
  };
};

const normalizeTags = (tags) => {
  if (!Array.isArray(tags)) {
    return [];
  }

  return tags
    .filter((tag) => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter(Boolean);
};

const normalizeText = (value) => {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim().toLowerCase();
};

const normalizeOptionalEmail = (email) => {
  if (typeof email !== 'string') {
    return '';
  }

  return email.trim().toLowerCase();
};

const isValidEmail = (email) => {
  if (!email) {
    return true;
  }

  return /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,})+$/.test(email);
};

const normalizeStatus = (status, defaultStatus = 'active') => {
  return normalizeText(status) || defaultStatus;
};

const normalizeSource = (source, defaultSource = 'manual') => {
  return normalizeText(source) || defaultSource;
};

const validateStatus = (status) => {
  return VALID_STATUSES.includes(status);
};

const validateSource = (source) => {
  return VALID_SOURCES.includes(source);
};

const formatContact = (contact) => ({
  _id: contact._id,
  businessId: contact.businessId,
  ownerId: contact.ownerId,
  name: contact.name,
  phone: contact.phone,
  email: contact.email,
  tags: contact.tags,
  status: contact.status,
  source: contact.source,
  notes: contact.notes,
  lastInteractionAt: contact.lastInteractionAt,
  totalRequests: contact.totalRequests,
  totalSpent: contact.totalSpent,
  createdBy: contact.createdBy,
  createdAt: contact.createdAt,
  updatedAt: contact.updatedAt,
});

const buildScopedQuery = (scope, extra = {}) => ({
  ...(scope.businessId
    ? { businessId: scope.businessId }
    : { ownerId: scope.ownerId, businessId: null }),
  isDeleted: false,
  ...extra,
});

/**
 * GET /api/contacts
 * List contacts for logged-in user's owner/business scope
 */
exports.getContacts = async (req, res, next) => {
  try {
    const currentUser = await getCurrentUser(req.user.id);

    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const scope = await getContactScope(currentUser);
    const {
      search,
      status,
      tag,
      source,
      page = 1,
      limit = 20,
    } = req.query;

    const query = buildScopedQuery(scope);

    if (status) {
      query.status = status;
    }

    if (tag) {
      query.tags = tag;
    }

    if (source) {
      query.source = source;
    }

    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [
        { name: searchRegex },
        { phone: searchRegex },
        { email: searchRegex },
      ];
    }

    const pageNumber = Math.max(Number(page) || 1, 1);
    const limitNumber = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const skip = (pageNumber - 1) * limitNumber;

    const [contacts, total] = await Promise.all([
      Contact.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNumber),
      Contact.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      count: contacts.length,
      total,
      page: pageNumber,
      pages: Math.ceil(total / limitNumber),
      contacts: contacts.map(formatContact),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/contacts
 * Manually add a contact
 */
exports.createContact = async (req, res, next) => {
  try {
    const currentUser = await getCurrentUser(req.user.id);

    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const {
      name,
      phone,
      email = '',
      tags = [],
      status = 'active',
      source = 'manual',
      notes = '',
    } = req.body;
    const normalizedEmail = normalizeOptionalEmail(email);
    const normalizedStatus = normalizeStatus(status);
    const normalizedSource = normalizeSource(source);

    if (!name || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Name and phone are required',
      });
    }

    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email',
      });
    }

    if (!validateStatus(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be active, inactive, or blocked',
      });
    }

    if (!validateSource(normalizedSource)) {
      return res.status(400).json({
        success: false,
        message: 'Source must be manual, import, whatsapp, or chatbot',
      });
    }

    const scope = await getContactScope(currentUser);
    const normalizedPhone = normalizePhone(phone);
    const existingContact = await Contact.findOne(buildScopedQuery(scope, { normalizedPhone }));

    if (existingContact) {
      return res.status(409).json({
        success: false,
        message: 'Contact already exists with this mobile number.',
      });
    }

    const contact = await Contact.create({
      ...scope,
      name,
      phone,
      normalizedPhone,
      email: normalizedEmail,
      tags: normalizeTags(tags),
      status: normalizedStatus,
      source: normalizedSource,
      notes: notes || '',
      createdBy: currentUser._id,
    });

    res.status(201).json({
      success: true,
      message: 'Contact created successfully',
      contact: formatContact(contact),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Contact already exists with this mobile number.',
      });
    }

    next(error);
  }
};

/**
 * GET /api/contacts/:id
 * Get a single contact
 */
exports.getContact = async (req, res, next) => {
  try {
    const currentUser = await getCurrentUser(req.user.id);

    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const contact = await Contact.findOne(buildScopedQuery(await getContactScope(currentUser), {
      _id: req.params.id,
    }));

    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'Contact not found',
      });
    }

    res.status(200).json({
      success: true,
      contact: formatContact(contact),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/contacts/:id
 * Update contact details
 */
exports.updateContact = async (req, res, next) => {
  try {
    const currentUser = await getCurrentUser(req.user.id);

    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const scope = await getContactScope(currentUser);
    const contact = await Contact.findOne(buildScopedQuery(scope, { _id: req.params.id }));

    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'Contact not found',
      });
    }

    if (req.body.phone && req.body.phone !== contact.phone) {
      const newNormalizedPhone = normalizePhone(req.body.phone);
      const duplicateContact = await Contact.findOne(buildScopedQuery(scope, {
        normalizedPhone: newNormalizedPhone,
        _id: { $ne: contact._id },
      }));

      if (duplicateContact) {
        return res.status(409).json({
          success: false,
          message: 'Contact already exists with this mobile number.',
        });
      }
    }

    if (req.body.email !== undefined) {
      const normalizedEmail = normalizeOptionalEmail(req.body.email);

      if (!isValidEmail(normalizedEmail)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid email',
        });
      }

      contact.email = normalizedEmail;
    }

    if (req.body.status !== undefined) {
      const normalizedStatus = normalizeStatus(req.body.status);

      if (!validateStatus(normalizedStatus)) {
        return res.status(400).json({
          success: false,
          message: 'Status must be active, inactive, or blocked',
        });
      }

      contact.status = normalizedStatus;
    }

    if (req.body.source !== undefined) {
      const normalizedSource = normalizeSource(req.body.source);

      if (!validateSource(normalizedSource)) {
        return res.status(400).json({
          success: false,
          message: 'Source must be manual, import, whatsapp, or chatbot',
        });
      }

      contact.source = normalizedSource;
    }

    if (req.body.name !== undefined) {
      contact.name = req.body.name;
    }

    if (req.body.phone !== undefined) {
      contact.phone = req.body.phone;
      contact.normalizedPhone = normalizePhone(req.body.phone);
    }

    if (req.body.tags !== undefined) {
      contact.tags = normalizeTags(req.body.tags);
    }

    if (req.body.notes !== undefined) {
      contact.notes = req.body.notes || '';
    }

    await contact.save();

    res.status(200).json({
      success: true,
      message: 'Contact updated successfully',
      contact: formatContact(contact),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Contact already exists with this mobile number.',
      });
    }

    next(error);
  }
};

/**
 * DELETE /api/contacts/:id
 * Soft delete a contact
 */
exports.deleteContact = async (req, res, next) => {
  try {
    const currentUser = await getCurrentUser(req.user.id);

    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const contact = await Contact.findOne(buildScopedQuery(await getContactScope(currentUser), {
      _id: req.params.id,
    }));

    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'Contact not found',
      });
    }

    contact.isDeleted = true;
    contact.status = 'inactive';
    await contact.save();

    res.status(200).json({
      success: true,
      message: 'Contact deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/contacts/import
 * Import contacts from JSON array
 */
exports.importContacts = async (req, res, next) => {
  try {
    const currentUser = await getCurrentUser(req.user.id);

    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const { contacts } = req.body;

    if (!Array.isArray(contacts)) {
      return res.status(400).json({
        success: false,
        message: 'Contacts must be an array',
      });
    }

    const scope = await getContactScope(currentUser);
    let importedCount = 0;
    let skippedCount = 0;
    const skipped = [];

    for (const [index, item] of contacts.entries()) {
      if (!item?.name || !item?.phone) {
        skippedCount += 1;
        skipped.push({
          index,
          phone: item?.phone || '',
          reason: 'Name and phone are required',
        });
        continue;
      }

      const normalizedEmail = normalizeOptionalEmail(item.email || '');
      const normalizedStatus = normalizeStatus(item.status, 'active');
      const normalizedSource = normalizeSource(item.source, 'import');

      if (!isValidEmail(normalizedEmail)) {
        skippedCount += 1;
        skipped.push({
          index,
          phone: item.phone,
          reason: 'Invalid email',
        });
        continue;
      }

      if (!validateStatus(normalizedStatus)) {
        skippedCount += 1;
        skipped.push({
          index,
          phone: item.phone,
          reason: 'Invalid status',
        });
        continue;
      }

      if (!validateSource(normalizedSource)) {
        skippedCount += 1;
        skipped.push({
          index,
          phone: item.phone,
          reason: 'Invalid source',
        });
        continue;
      }

      const normalizedPhoneValue = normalizePhone(item.phone);
      const existingContact = await Contact.findOne(buildScopedQuery(scope, { normalizedPhone: normalizedPhoneValue }));

      if (existingContact) {
        skippedCount += 1;
        skipped.push({
          index,
          phone: item.phone,
          reason: 'Duplicate phone',
        });
        continue;
      }

      try {
        await Contact.create({
          ...scope,
          name: item.name,
          phone: item.phone,
          normalizedPhone: normalizedPhoneValue,
          email: normalizedEmail,
          tags: normalizeTags(item.tags),
          status: normalizedStatus,
          notes: item.notes || '',
          source: normalizedSource,
          createdBy: currentUser._id,
        });

        importedCount += 1;
      } catch (error) {
        skippedCount += 1;
        skipped.push({
          index,
          phone: item.phone,
          reason: error.code === 11000 ? 'Duplicate phone' : 'Invalid contact data',
        });
      }
    }

    res.status(200).json({
      success: true,
      message: 'Contacts imported successfully',
      importedCount,
      skippedCount,
      skipped,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/contacts/auto-create
 * Create or return contact from future WhatsApp/chatbot message flow
 */
exports.autoCreateContact = async (req, res, next) => {
  try {
    const currentUser = await getCurrentUser(req.user.id);

    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const { name = 'Unknown Customer', phone, source = 'whatsapp' } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone is required',
      });
    }

    if (!['whatsapp', 'chatbot'].includes(source)) {
      return res.status(400).json({
        success: false,
        message: 'Source must be whatsapp or chatbot',
      });
    }

    const scope = await getContactScope(currentUser);
    const normalizedPhone = normalizePhone(phone);
    const existingContact = await Contact.findOne(buildScopedQuery(scope, { normalizedPhone }));

    if (existingContact) {
      return res.status(200).json({
        success: true,
        message: 'Contact already exists',
        contact: formatContact(existingContact),
      });
    }

    const contact = await Contact.create({
      ...scope,
      name,
      phone,
      normalizedPhone,
      source,
      createdBy: currentUser._id,
    });

    res.status(201).json({
      success: true,
      message: 'Contact auto-created successfully',
      contact: formatContact(contact),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Contact already exists with this mobile number.',
      });
    }

    next(error);
  }
};
