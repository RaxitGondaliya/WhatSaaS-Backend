const cloudinary = require('../config/cloudinary');
const fs = require('fs');

/**
 * Upload an image to Cloudinary
 * Route: POST /api/upload/image
 */
exports.uploadImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided' });
    }

    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: 'chatbot',
      use_filename: true,
      unique_filename: true,
      resource_type: 'image',
    });

    // Remove the file from local temp storage
    fs.unlinkSync(req.file.path);

    res.status(200).json({
      success: true,
      imageUrl: result.secure_url,
      publicId: result.public_id,
      imageName: req.file.originalname,
    });
  } catch (error) {
    console.error('Error uploading image to Cloudinary:', error);
    
    // Attempt to clean up temp file if error occurs
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      success: false,
      message: 'Failed to upload image',
      error: error.message,
    });
  }
};
