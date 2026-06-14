const User = require('../models/User');

const ALL_MODULES = [
  'dashboard',
  'contacts',
  'chatbot',
  'templates',
  'broadcast',
  'requests',
  'analytics',
  'wallet',
  'reports',
  'settings',
];

const DEFAULT_MODULES_BY_ROLE = {
  admin: ALL_MODULES,
  manager: ['dashboard', 'requests', 'contacts', 'analytics'],
  staff: ['requests'],
};

const MANAGEABLE_ROLES = ['admin', 'manager', 'staff'];

const normalizeText = (value) => {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim().toLowerCase();
};

const normalizeModules = (modules) => {
  if (!Array.isArray(modules)) {
    return modules;
  }

  return modules.map((module) => normalizeText(module)).filter(Boolean);
};

const validateAllowedModules = (modules) => {
  if (!Array.isArray(modules)) {
    return 'Allowed modules must be an array';
  }

  const invalidModules = modules.filter((module) => !ALL_MODULES.includes(module));
  if (invalidModules.length > 0) {
    return `Invalid allowed modules: ${invalidModules.join(', ')}`;
  }

  return null;
};

const formatTeamMember = (user, options = {}) => ({
  _id: user._id,
  fullName: user.fullName,
  email: user.email,
  phone: user.phone,
  username: user.username,
  role: options.isOwner ? 'owner' : user.role,
  displayRole: options.isOwner ? 'Admin' : user.role,
  isOwner: Boolean(options.isOwner),
  businessId: user.businessId,
  allowedModules: user.allowedModules,
  isActive: user.isActive,
  isVerified: user.isVerified,
  lastLogin: user.lastLogin,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const getCurrentUser = async (userId) => {
  return User.findById(userId);
};

const getAllowedModules = (role, allowedModules) => {
  if (Array.isArray(allowedModules) && allowedModules.length > 0) {
    return allowedModules;
  }

  return DEFAULT_MODULES_BY_ROLE[role] || DEFAULT_MODULES_BY_ROLE.staff;
};

/**
 * POST /api/team/members
 * Add a team member to current user's business
 */
exports.createMember = async (req, res, next) => {
  try {
    const currentUser = await getCurrentUser(req.user.id);

    if (!currentUser?.businessId) {
      return res.status(400).json({
        success: false,
        message: 'Please complete business setup before adding team members',
      });
    }

    const {
      fullName,
      email,
      phone,
      username,
      password,
      role = 'staff',
      allowedModules,
    } = req.body;
    const normalizedRole = normalizeText(role) || 'staff';
    const normalizedAllowedModules = allowedModules !== undefined ? normalizeModules(allowedModules) : undefined;

    if (!fullName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide full name, email, and password',
      });
    }

    if (!MANAGEABLE_ROLES.includes(normalizedRole)) {
      return res.status(400).json({
        success: false,
        message: 'Role must be admin, manager, or staff',
      });
    }

    if (normalizedAllowedModules !== undefined) {
      const allowedModulesError = validateAllowedModules(normalizedAllowedModules);
      if (allowedModulesError) {
        return res.status(400).json({
          success: false,
          message: allowedModulesError,
        });
      }
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters',
      });
    }

    const existingUser = await User.findOne({
      $or: [
        { email: email.toLowerCase() },
        ...(username ? [{ username: username.toLowerCase() }] : []),
      ],
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: existingUser.email === email.toLowerCase() ? 'Email already exists' : 'Username already exists',
      });
    }

    const member = await User.create({
      fullName,
      email: email.toLowerCase(),
      phone: phone || null,
      username: username || null,
      password,
      role: normalizedRole,
      businessId: currentUser.businessId,
      allowedModules: getAllowedModules(normalizedRole, normalizedAllowedModules),
      isVerified: true,
      authProvider: 'local',
    });

    res.status(201).json({
      success: true,
      message: 'Team member created successfully',
      user: formatTeamMember(member),
    });
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0];
      return res.status(409).json({
        success: false,
        message: field === 'username' ? 'Username already exists' : 'Email already exists',
      });
    }

    next(error);
  }
};

/**
 * GET /api/team/members
 * List team members from current user's business
 */
exports.getMembers = async (req, res, next) => {
  try {
    const currentUser = await getCurrentUser(req.user.id);

    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    let members = [];

    if (currentUser.businessId) {
      members = await User.find({
        businessId: currentUser.businessId,
        _id: { $ne: currentUser._id },
        role: { $ne: 'owner' },
      }).sort({ createdAt: -1 });
    }
    const users = [currentUser, ...members];

    res.status(200).json({
      success: true,
      count: users.length,
      users: users.map((user, index) => formatTeamMember(user, { isOwner: index === 0 })),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/team/members/:id/access
 * Update a team member role and module access
 */
exports.updateMemberAccess = async (req, res, next) => {
  try {
    const currentUser = await getCurrentUser(req.user.id);

    if (!currentUser?.businessId) {
      return res.status(400).json({
        success: false,
        message: 'Business setup not found',
      });
    }

    const { role, allowedModules } = req.body;
    const normalizedRole = role !== undefined ? normalizeText(role) : undefined;
    const normalizedAllowedModules = allowedModules !== undefined ? normalizeModules(allowedModules) : undefined;

    if (normalizedRole && !MANAGEABLE_ROLES.includes(normalizedRole)) {
      return res.status(400).json({
        success: false,
        message: 'Owner role cannot be assigned from this API',
      });
    }

    if (normalizedAllowedModules !== undefined) {
      const allowedModulesError = validateAllowedModules(normalizedAllowedModules);
      if (allowedModulesError) {
        return res.status(400).json({
          success: false,
          message: allowedModulesError,
        });
      }
    }

    const member = await User.findOne({
      _id: req.params.id,
      businessId: currentUser.businessId,
    });

    if (!member) {
      return res.status(404).json({
        success: false,
        message: 'Team member not found',
      });
    }

    if (member.role === 'owner') {
      return res.status(400).json({
        success: false,
        message: 'Owner access cannot be managed from this API',
      });
    }

    if (normalizedRole) {
      member.role = normalizedRole;
    }

    if (normalizedAllowedModules !== undefined) {
      member.allowedModules = normalizedAllowedModules;
    } else if (normalizedRole) {
      member.allowedModules = getAllowedModules(normalizedRole);
    }

    await member.save();

    res.status(200).json({
      success: true,
      message: 'Team member access updated successfully',
      user: formatTeamMember(member),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/team-members/:id/status
 * Activate or deactivate a team member.
 */
exports.updateMemberStatus = async (req, res, next) => {
  try {
    const currentUser = await getCurrentUser(req.user.id);

    if (!currentUser?.businessId) {
      return res.status(400).json({
        success: false,
        message: 'Business setup not found',
      });
    }

    if (req.params.id === String(currentUser._id)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot change status for current logged-in user',
      });
    }

    if (typeof req.body.isActive !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'isActive must be true or false',
      });
    }

    const member = await User.findOne({
      _id: req.params.id,
      businessId: currentUser.businessId,
    });

    if (!member) {
      return res.status(404).json({
        success: false,
        message: 'Team member not found',
      });
    }

    if (member.role === 'owner') {
      return res.status(400).json({
        success: false,
        message: 'Cannot change owner status from this API',
      });
    }

    member.isActive = req.body.isActive;
    await member.save();

    res.status(200).json({
      success: true,
      message: 'Team member status updated successfully',
      user: formatTeamMember(member),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/team-members/:id
 * Update team member details and access fields
 */
exports.updateMember = async (req, res, next) => {
  try {
    const currentUser = await getCurrentUser(req.user.id);

    if (!currentUser?.businessId) {
      return res.status(400).json({
        success: false,
        message: 'Business setup not found',
      });
    }

    if (req.params.id === String(currentUser._id)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot edit owner/current user from this API',
      });
    }

    const {
      fullName,
      email,
      phone,
      username,
      role,
      allowedModules,
    } = req.body;

    const normalizedEmail = normalizeText(email);
    const normalizedUsername = normalizeText(username);
    const normalizedRole = normalizeText(role);
    const normalizedAllowedModules = allowedModules !== undefined ? normalizeModules(allowedModules) : undefined;

    if (!fullName) {
      return res.status(400).json({
        success: false,
        message: 'Full name is required',
      });
    }

    if (!normalizedEmail) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    if (!normalizedUsername) {
      return res.status(400).json({
        success: false,
        message: 'Username is required',
      });
    }

    if (normalizedRole && !MANAGEABLE_ROLES.includes(normalizedRole)) {
      return res.status(400).json({
        success: false,
        message: 'Owner role cannot be assigned from this API',
      });
    }

    if (normalizedAllowedModules !== undefined) {
      const allowedModulesError = validateAllowedModules(normalizedAllowedModules);
      if (allowedModulesError) {
        return res.status(400).json({
          success: false,
          message: allowedModulesError,
        });
      }
    }

    const member = await User.findOne({
      _id: req.params.id,
      businessId: currentUser.businessId,
    });

    if (!member) {
      return res.status(404).json({
        success: false,
        message: 'Team member not found',
      });
    }

    if (member.role === 'owner') {
      return res.status(400).json({
        success: false,
        message: 'Owner cannot be edited from this API',
      });
    }

    const duplicateUser = await User.findOne({
      _id: { $ne: member._id },
      $or: [
        { email: normalizedEmail },
        { username: normalizedUsername },
      ],
    });

    if (duplicateUser) {
      return res.status(409).json({
        success: false,
        message: duplicateUser.email === normalizedEmail ? 'Email already exists' : 'Username already exists',
      });
    }

    member.fullName = fullName;
    member.email = normalizedEmail;
    member.phone = phone || null;
    member.username = normalizedUsername;

    if (normalizedRole) {
      member.role = normalizedRole;
    }

    if (normalizedAllowedModules !== undefined) {
      member.allowedModules = normalizedAllowedModules;
    } else if (normalizedRole) {
      member.allowedModules = getAllowedModules(normalizedRole);
    }

    await member.save();

    res.status(200).json({
      success: true,
      message: 'Team member updated successfully',
      user: formatTeamMember(member),
    });
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0];
      return res.status(409).json({
        success: false,
        message: field === 'username' ? 'Username already exists' : 'Email already exists',
      });
    }

    next(error);
  }
};

/**
 * PUT /api/team-members/:id/reset-password
 * Reset a staff/team member password
 */
exports.resetMemberPassword = async (req, res, next) => {
  try {
    const currentUser = await getCurrentUser(req.user.id);

    if (!currentUser?.businessId) {
      return res.status(400).json({
        success: false,
        message: 'Business setup not found',
      });
    }

    if (req.params.id === String(currentUser._id)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot reset your own password from this endpoint',
      });
    }

    const { newPassword, confirmPassword } = req.body;

    if (!newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide new password and confirm password',
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match',
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters',
      });
    }

    const member = await User.findOne({
      _id: req.params.id,
      businessId: currentUser.businessId,
    }).select('+password');

    if (!member) {
      return res.status(404).json({
        success: false,
        message: 'Team member not found',
      });
    }

    if (member.role === 'owner') {
      return res.status(400).json({
        success: false,
        message: 'Cannot reset owner password from this endpoint',
      });
    }

    member.password = newPassword;
    await member.save();

    res.status(200).json({
      success: true,
      message: 'Staff password reset successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/team/members/:id
 * Soft delete a team member
 */
exports.deleteMember = async (req, res, next) => {
  try {
    const currentUser = await getCurrentUser(req.user.id);

    if (!currentUser?.businessId) {
      return res.status(400).json({
        success: false,
        message: 'Business setup not found',
      });
    }

    const member = await User.findOne({
      _id: req.params.id,
      businessId: currentUser.businessId,
    });

    if (!member) {
      return res.status(404).json({
        success: false,
        message: 'Team member not found',
      });
    }

    if (member.role === 'owner') {
      return res.status(400).json({
        success: false,
        message: 'Owner cannot be deleted',
      });
    }

    member.isActive = false;
    await member.save();

    res.status(200).json({
      success: true,
      message: 'Team member deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};
