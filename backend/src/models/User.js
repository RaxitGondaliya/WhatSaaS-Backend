const mongoose = require('mongoose');
const bcryptjs = require('bcryptjs');

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

const getDefaultAllowedModules = (role) => {
  if (role === 'manager') {
    return ['dashboard', 'requests', 'contacts', 'analytics'];
  }

  if (role === 'staff') {
    return ['requests'];
  }

  return ALL_MODULES;
};

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Please provide a full name'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Please provide an email'],
      unique: [true, 'Email already exists'],
      lowercase: true,
      trim: true,
      match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email'],
    },
    phone: {
      type: String,
      trim: true,
      default: null,
    },
    username: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
      default: null,
    },
    password: {
      type: String,
      required: function () {
        return this.authProvider === 'local';
      },
      minlength: [6, 'Password must be at least 6 characters'],
      select: false,
    },
    authProvider: {
      type: String,
      enum: {
        values: ['local', 'google'],
        message: 'Auth provider must be local or google',
      },
      default: 'local',
    },
    googleId: {
      type: String,
      default: null,
    },
    profileImage: {
      type: String,
      default: null,
    },
    role: {
      type: String,
      enum: {
        values: ['owner', 'admin', 'manager', 'staff'],
        message: 'Role must be owner, admin, manager, or staff',
      },
      default: 'owner',
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      default: null,
    },
    allowedModules: {
      type: [String],
      default: function () {
        return getDefaultAllowedModules(this.role);
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    lastLogin: {
      type: Date,
      default: null,
    },
    resetPasswordOtp: {
      type: String,
      default: null,
      select: false,
    },
    resetPasswordOtpExpires: {
      type: Date,
      default: null,
      select: false,
    },
    resetPasswordOtpVerified: {
      type: Boolean,
      default: false,
      select: false,
    },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
userSchema.pre('save', async function (next) {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified('password') || !this.password) {
    return next();
  }

  try {
    const salt = await bcryptjs.genSalt(10);
    this.password = await bcryptjs.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare password
userSchema.methods.comparePassword = async function (enteredPassword) {
  if (!this.password) {
    return false;
  }

  return await bcryptjs.compare(enteredPassword, this.password);
};

// Method to get user without password
userSchema.methods.toJSON = function () {
  const { password, ...user } = this.toObject();
  return user;
};

module.exports = mongoose.model('User', userSchema);
