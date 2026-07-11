const nodemailer = require('nodemailer');

const sendContactEmail = async ({ name, email, mobile, company, subject, message }) => {
  const receiverEmail = process.env.CONTACT_RECEIVER_EMAIL;
  
  if (!receiverEmail) {
    console.error('[ContactEmailService] CONTACT_RECEIVER_EMAIL is not defined in environment variables.');
    throw new Error('Contact receiver email is not configured.');
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: process.env.SMTP_PORT === '465', // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const submittedTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>New Contact Submission</title>
      <style>
        body { font-family: Arial, sans-serif; background-color: #f4f4f5; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
        h2 { color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; margin-top: 0; }
        .field { margin-bottom: 15px; }
        .label { font-weight: bold; color: #475569; display: block; margin-bottom: 5px; }
        .value { color: #1e293b; background: #f8fafc; padding: 10px; border-radius: 4px; border: 1px solid #e2e8f0; }
        .message-box { white-space: pre-wrap; color: #1e293b; background: #f8fafc; padding: 15px; border-radius: 4px; border: 1px solid #e2e8f0; }
        .footer { margin-top: 30px; font-size: 12px; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 15px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>New Contact Form Submission</h2>
        
        <div class="field">
          <span class="label">Name:</span>
          <div class="value">${name}</div>
        </div>
        
        <div class="field">
          <span class="label">Email:</span>
          <div class="value">${email}</div>
        </div>
        
        ${mobile ? `
        <div class="field">
          <span class="label">Mobile:</span>
          <div class="value">${mobile}</div>
        </div>
        ` : ''}
        
        ${company ? `
        <div class="field">
          <span class="label">Company:</span>
          <div class="value">${company}</div>
        </div>
        ` : ''}
        
        <div class="field">
          <span class="label">Subject:</span>
          <div class="value">${subject}</div>
        </div>
        
        <div class="field">
          <span class="label">Message:</span>
          <div class="message-box">${message}</div>
        </div>
        
        <div class="footer">
          Submitted Time: ${submittedTime}<br/>
          This is an automated notification from your WhatsSaaS website.
        </div>
      </div>
    </body>
    </html>
  `;

  const mailOptions = {
    from: `"${process.env.SMTP_FROM_NAME || 'WhatsSaaS'}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
    to: receiverEmail,
    subject: `New Contact Submission: ${subject}`,
    html: htmlContent,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`[ContactEmailService] Email sent successfully to ${receiverEmail}. Message ID: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error(`[ContactEmailService] Error sending email to ${receiverEmail}:`, error);
    throw error;
  }
};

module.exports = {
  sendContactEmail,
};
