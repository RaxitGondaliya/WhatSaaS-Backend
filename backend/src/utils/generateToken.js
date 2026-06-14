/**
 * JWT Token Generation Utility
 * Ready for use in authentication routes
 */

const jwt = require('jsonwebtoken');

/**
 * Generate JWT Token
 * @param {Object} payload - Data to encode in token (e.g., user ID)
 * @param {String} secret - Secret key (default: JWT_SECRET from env)
 * @param {String} expiresIn - Token expiration (default: JWT_EXPIRES_IN from env)
 * @returns {String} JWT token
 */
const generateToken = (
  payload,
  secret = process.env.JWT_SECRET,
  expiresIn = process.env.JWT_EXPIRES_IN
) => {
  return jwt.sign(payload, secret, { expiresIn });
};

/**
 * Verify JWT Token
 * @param {String} token - JWT token to verify
 * @param {String} secret - Secret key (default: JWT_SECRET from env)
 * @returns {Object} Decoded token payload
 */
const verifyToken = (token, secret = process.env.JWT_SECRET) => {
  return jwt.verify(token, secret);
};

module.exports = {
  generateToken,
  verifyToken,
};
