const express = require('express');
const websiteContactController = require('../controllers/websiteContactController');
const { validateContactForm } = require('../validators/websiteContactValidator');

const router = express.Router();

// Public route for website contact form submissions
router.post('/', validateContactForm, websiteContactController.submitContactForm);

module.exports = router;
