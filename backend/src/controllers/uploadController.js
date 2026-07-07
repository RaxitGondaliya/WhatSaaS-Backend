const cloudinary = require('../config/cloudinary');
const fs = require('fs');

/**
 * Upload an image to Cloudinary
 * Route: POST /api/upload/image
 */
exports.uploadImage = async (req, res) => {
  try {
    console.log('[uploadImage] req.file:', req.file);
    console.log('[uploadImage] req.body:', req.body);

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided' });
    }

    // Validate Cloudinary Config
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      console.error('[uploadImage] Cloudinary configuration is missing');
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(500).json({
        success: false,
        message: 'Server configuration error: Cloudinary keys are missing.',
      });
    }

    // Validate size (10MB limit)
    const MAX_SIZE = 10 * 1024 * 1024;
    if (req.file.size > MAX_SIZE) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'File is too large. Max size is 10MB.' });
    }

    // Validate type
    if (!req.file.mimetype.startsWith('image/')) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'Invalid file type. Only images are allowed.' });
    }

    // Upload to Cloudinary using preset
    const result = await cloudinary.uploader.upload(req.file.path, {
      upload_preset: 'chatbot_images',
      folder: 'chatbot',
      use_filename: true,
      unique_filename: true,
      resource_type: 'image',
    });

    // Remove the file from local temp storage
    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    return res.status(200).json({
      success: true,
      imageUrl: result.secure_url,
      publicId: result.public_id,
      imageName: req.file.originalname,
    });
  } catch (error) {
    console.error('Error uploading image to Cloudinary:');
    console.error('- Message:', error.message);
    console.error('- Stack:', error.stack);
    console.error('- Error Code:', error.http_code || error.code || 'UNKNOWN');
    if (error.response) {
       console.error('- Response:', JSON.stringify(error.response, null, 2));
    }
    
    // Attempt to clean up temp file if error occurs
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to upload image',
      error: {
        message: error.message,
        code: error.http_code || error.code,
        details: error.response || null
      }
    });
  }
};
