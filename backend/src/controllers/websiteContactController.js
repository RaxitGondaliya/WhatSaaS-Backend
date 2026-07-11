const websiteContactEmailService = require('../services/websiteContactEmailService');

exports.submitContactForm = async (req, res, next) => {
  try {
    console.log('Controller execution started');
    const { fullName, email, mobile, company, subject, message } = req.body;

    console.log('Sending email...');

    // Send email using the dedicated email service
    await websiteContactEmailService.sendContactEmail({
      name: fullName,
      email,
      mobile: mobile || '',
      company: company || '',
      subject,
      message,
    });

    console.log('Contact API completed');
    return res.status(200).json({
      success: true,
      message: 'Contact form submitted successfully.',
    });
  } catch (error) {
    console.error('[WebsiteContactController] Error submitting contact form:', error);
    
    // In a public endpoint, we should avoid exposing detailed internal errors
    // unless it's a known configuration error we want to explicitly handle
    if (error.message === 'Contact receiver email is not configured.') {
      return res.status(500).json({
        success: false,
        message: 'Email service is not fully configured on the server.',
      });
    }

    return res.status(500).json({
      success: false,
      message: 'An error occurred while sending your message. Please try again later.',
    });
  }
};
