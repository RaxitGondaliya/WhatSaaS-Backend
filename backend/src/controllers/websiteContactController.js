const websiteContactEmailService = require('../services/websiteContactEmailService');

exports.submitContactForm = async (req, res, next) => {
  try {
    console.log('[Contact] Controller execution started');
    const { name, email, mobile, company, subject, message } = req.body;

    // Send email using the dedicated email service
    await websiteContactEmailService.sendContactEmail({
      name,
      email,
      mobile: mobile || '',
      company: company || '',
      subject,
      message,
    });

    console.log('[Contact] Contact API completed');
    return res.status(200).json({
      success: true,
      message: 'Contact form submitted successfully.',
    });
  } catch (error) {
    console.error('[Contact] ERROR:', error.message || error);
    
    // In development or when asked, return the real error
    return res.status(500).json({
      success: false,
      message: 'An error occurred while sending your message. Please try again later.',
      error: error.message || String(error),
    });
  }
};
