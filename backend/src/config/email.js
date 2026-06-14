/**
 * Email Configuration
 * Loads SMTP credentials from environment variables
 * Support for multiple providers (Gmail, Zoho, SendGrid, etc.)
 */

const nodemailer = require('nodemailer');

// Load and trim SMTP configuration from environment variables
const smtpHost = process.env.SMTP_HOST?.trim() || 'smtp.gmail.com';
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpUser = process.env.SMTP_USER?.trim();
const smtpPass = process.env.SMTP_PASS?.replace(/\s/g, ''); // Remove all spaces (Gmail app passwords often have spaces)

// Debug logs (safe - no actual password)
console.log('📧 SMTP Configuration:');
console.log('  Host:', smtpHost);
console.log('  Port:', smtpPort);
console.log('  User:', smtpUser);
console.log('  Password length:', smtpPass?.length || 0, 'characters');

// SMTP configuration object
const smtpConfig = {
  host: smtpHost,
  port: smtpPort,
  secure: smtpPort === 465, // true for 465, false for other ports
  auth: {
    user: smtpUser,
    pass: smtpPass,
  },
};

// Create transporter
const transporter = nodemailer.createTransport(smtpConfig);

// Verify SMTP connection on startup
transporter.verify((error, success) => {
  if (error) {
    console.error('❌ SMTP verification failed:', error.message);
  } else {
    console.log('✅ SMTP server ready and verified');
  }
});

module.exports = transporter;
