const User = require('../models/User');
const { generateToken } = require('../utils/generateToken');
const { OAuth2Client } = require('google-auth-library');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const formatAuthUser = (user) => ({
  _id: user._id,
  fullName: user.fullName,
  email: user.email,
  role: user.role,
  businessId: user.businessId,
  allowedModules: user.allowedModules,
  isActive: user.isActive,
  isVerified: user.isVerified,
  authProvider: user.authProvider,
  googleId: user.googleId,
  profileImage: user.profileImage,
  lastLogin: user.lastLogin,
});

/**
 * POST /api/auth/signup
 * Register a new user
 */
exports.signup = async (req, res, next) => {
  try {
    const { fullName, email, password, confirmPassword } = req.body;

    // Validation
    if (!fullName || !email || !password || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields',
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters',
      });
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'Email already exists',
      });
    }

    // Create user
    const user = await User.create({
      fullName,
      email: email.toLowerCase(),
      password,
    });

    // Generate token
    const token = generateToken({ id: user._id });

    // Return response without password
    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      token,
      user: {
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        allowedModules: user.allowedModules,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Email already exists',
      });
    }
    next(error);
  }
};

/**
 * POST /api/auth/login
 * Login user
 */
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password',
      });
    }

    // Find user and include password field
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated',
      });
    }

    // Compare password
    const isPasswordCorrect = await user.comparePassword(password);
    if (!isPasswordCorrect) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate token
    const token = generateToken({ id: user._id });

    // Return response without password
    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        businessId: user.businessId,
        allowedModules: user.allowedModules,
        isActive: user.isActive,
        isVerified: user.isVerified,
        lastLogin: user.lastLogin,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/auth/google
 * Login or register user with Google ID token
 */
exports.googleLogin = async (req, res, next) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({
        success: false,
        message: 'Please provide Google credential',
      });
    }

    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(500).json({
        success: false,
        message: 'Google login is not configured',
      });
    }

    let payload;

    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });

      payload = ticket.getPayload();
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Google token',
      });
    }

    const {
      sub: googleId,
      name,
      email,
      picture,
      email_verified: emailVerified,
    } = payload;

    if (!email || !googleId || !emailVerified) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Google token',
      });
    }

    let user = await User.findOne({ email: email.toLowerCase() });

    if (user) {
      if (!user.isActive) {
        return res.status(403).json({
          success: false,
          message: 'Your account has been deactivated',
        });
      }

      user.lastLogin = new Date();
      user.googleId = user.googleId || googleId;
      user.profileImage = user.profileImage || picture || null;

      if (user.authProvider !== 'google') {
        user.authProvider = 'google';
      }

      if (!user.isVerified) {
        user.isVerified = true;
      }

      await user.save();
    } else {
      user = await User.create({
        fullName: name || email.split('@')[0],
        email: email.toLowerCase(),
        password: null,
        role: 'owner',
        isVerified: true,
        authProvider: 'google',
        googleId,
        profileImage: picture || null,
        lastLogin: new Date(),
      });
    }

    const token = generateToken({ id: user._id });

    res.status(200).json({
      success: true,
      message: 'Google login successful',
      token,
      user: formatAuthUser(user),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/auth/me
 * Get current user (protected route)
 */
exports.getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.status(200).json({
      success: true,
      user: {
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        businessId: user.businessId,
        allowedModules: user.allowedModules,
        isActive: user.isActive,
        isVerified: user.isVerified,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/auth/logout
 * Logout user
 */
exports.logout = async (req, res, next) => {
  try {
    res.status(200).json({
      success: true,
      message: 'Logout successful',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/auth/forgot-password
 * Send OTP to email for password reset
 */
exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    // Validation
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an email',
      });
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(200).json({
        success: false,
        otpSent: false,
        message: 'No account found with this email address.',
      });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Set OTP and expiry (10 minutes)
    user.resetPasswordOtp = otp;
    user.resetPasswordOtpExpires = new Date(Date.now() + 10 * 60 * 1000);
    user.resetPasswordOtpVerified = false;

    // Save user
    await user.save();

    // Send OTP email
    const sendEmail = require('../utils/sendEmail');
    const emailHtml = `
      <h2>Password Reset Request</h2>
      <p>Hello ${user.fullName},</p>
      <p>Your OTP for password reset is:</p>
      <h1 style="letter-spacing: 2px; color: #007bff;">${otp}</h1>
      <p style="color: #666; font-size: 14px;">This OTP will expire in 10 minutes.</p>
      <p>If you did not request a password reset, please ignore this email.</p>
    `;

    const emailText = `Password Reset OTP: ${otp}\n\nThis OTP will expire in 10 minutes.`;

    const emailResult = await sendEmail({
      to: user.email,
      subject: 'Password Reset OTP',
      html: emailHtml,
      text: emailText,
    });

    // Check if email sending failed
    if (!emailResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send OTP email. Please try again.',
      });
    }

    res.status(200).json({
      success: true,
      otpSent: true,
      message: 'OTP sent successfully.',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/auth/verify-reset-otp
 * Verify OTP for password reset
 */
exports.verifyResetOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;

    // Validation
    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and OTP',
      });
    }

    // Find user with OTP fields
    const user = await User.findOne({ email: email.toLowerCase() })
      .select('+resetPasswordOtp +resetPasswordOtpExpires +resetPasswordOtpVerified');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or OTP',
      });
    }

    // Check if OTP exists
    if (!user.resetPasswordOtp) {
      return res.status(401).json({
        success: false,
        message: 'No OTP found. Please request a password reset first.',
      });
    }

    // Check if OTP matches
    if (user.resetPasswordOtp !== otp) {
      return res.status(401).json({
        success: false,
        message: 'Invalid OTP',
      });
    }

    // Check if OTP is expired
    if (new Date() > user.resetPasswordOtpExpires) {
      return res.status(401).json({
        success: false,
        message: 'OTP has expired',
      });
    }

    // Mark OTP as verified
    user.resetPasswordOtpVerified = true;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'OTP verified successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/auth/reset-password
 * Reset password after OTP verification
 */
exports.resetPassword = async (req, res, next) => {
  try {
    const { email, newPassword, confirmPassword } = req.body;

    // Validation
    if (!email || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields',
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

    // Find user with OTP verification field
    const user = await User.findOne({ email: email.toLowerCase() })
      .select('+resetPasswordOtpVerified');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found',
      });
    }

    // Check if OTP was verified
    if (!user.resetPasswordOtpVerified) {
      return res.status(401).json({
        success: false,
        message: 'Please verify OTP first',
      });
    }

    // Update password (will be hashed by pre-save hook)
    user.password = newPassword;

    // Clear OTP fields
    user.resetPasswordOtp = null;
    user.resetPasswordOtpExpires = null;
    user.resetPasswordOtpVerified = false;

    // Save user
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password reset successfully',
    });
  } catch (error) {
    next(error);
  }
};
