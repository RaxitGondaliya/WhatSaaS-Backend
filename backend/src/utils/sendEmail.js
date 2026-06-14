/**
 * Email Sending Utility
 * Centralized email handler for all outgoing emails
 * Used for OTP, notifications, invites, etc.
 */

const transporter = require('../config/email');

/**
 * Send Email
 * @param {Object} options - Email options
 * @param {String} options.to - Recipient email
 * @param {String} options.subject - Email subject
 * @param {String} options.html - HTML body
 * @param {String} options.text - Plain text body (optional)
 * @returns {Promise} Email send result
 */
const sendEmail = async (options) => {
  try {
    const mailOptions = {
      from: (process.env.SMTP_FROM || process.env.SMTP_USER)?.trim(),
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text || '',
    };

    const info = await transporter.sendMail(mailOptions);

    console.log(`✓ Email sent to ${options.to}`);
    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error) {
    console.error(`✗ Email send failed: ${error.message}`);
    return {
      success: false,
      error: error.message,
    };
  }
};

module.exports = sendEmail;
