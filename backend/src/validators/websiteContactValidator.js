exports.validateContactForm = (req, res, next) => {
  console.log('Contact request received');
  console.log('Incoming request body:', req.body);
  
  const { name, email, mobile, company, subject, message } = req.body;
  const errors = [];

  if (!name || name.trim() === '') {
    errors.push({ field: 'name', reason: 'Name is required.' });
  }

  if (mobile && mobile.trim() !== '') {
    const cleanMobile = mobile.replace(/[\s\-\+\(\)]/g, '');
    if (!/^\d{10,}$/.test(cleanMobile)) {
      errors.push({ field: 'mobile', reason: 'Please provide a valid mobile number.' });
    }
  }

  if (!email || email.trim() === '') {
    errors.push({ field: 'email', reason: 'Email is required.' });
  } else if (!/^\S+@\S+\.\S+$/.test(email)) {
    errors.push({ field: 'email', reason: 'Please provide a valid email address.' });
  }

  if (!subject || subject.trim() === '') {
    errors.push({ field: 'subject', reason: 'Subject is required.' });
  }

  if (!message || message.trim() === '') {
    errors.push({ field: 'message', reason: 'Message is required.' });
  }

  console.log('Validation result:', errors.length === 0 ? 'Passed' : 'Failed', errors);

  if (errors.length > 0) {
    console.log('Validation errors:', errors);
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors,
    });
  }

  console.log('Validation passed');
  next();
};
