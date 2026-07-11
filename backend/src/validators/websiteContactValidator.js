exports.validateContactForm = (req, res, next) => {
  const { name, email, subject, message } = req.body;
  const errors = [];

  if (!name || name.trim() === '') {
    errors.push('Name is required.');
  }

  if (!email || email.trim() === '') {
    errors.push('Email is required.');
  } else if (!/^\S+@\S+\.\S+$/.test(email)) {
    errors.push('Please provide a valid email address.');
  }

  if (!subject || subject.trim() === '') {
    errors.push('Subject is required.');
  }

  if (!message || message.trim() === '') {
    errors.push('Message is required.');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors,
    });
  }

  next();
};
