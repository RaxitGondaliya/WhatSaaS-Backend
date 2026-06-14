/**
 * Authentication Middleware
 * - protect: Verify JWT tokens and attach user to request
 * - authorize: Check user role permissions
 */

const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Protect Route - Verify JWT and attach user to request
 */
const protect = async (req, res, next) => {
  try {
    // Extract token from Authorization header
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided. Please login first',
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Find user by decoded id
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found',
      });
    }

    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated',
      });
    }

    // Attach user to request
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token',
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired. Please login again',
      });
    }

    return res.status(401).json({
      success: false,
      message: 'Authentication failed',
      error: error.message,
    });
  }
};

/**
 * Authorize by Role - Check if user has required role(s)
 * Usage: router.get('/route', protect, authorize('owner', 'admin'), controller)
 */
const authorize = (...allowedRoles) => {
  return async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id);

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'User not found',
        });
      }

      if (!allowedRoles.includes(user.role)) {
        return res.status(403).json({
          success: false,
          message: `You do not have permission to access this resource. Required role: ${allowedRoles.join(', ')}`,
        });
      }

      next();
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Authorization check failed',
        error: error.message,
      });
    }
  };
};

module.exports = { protect, authorize };
