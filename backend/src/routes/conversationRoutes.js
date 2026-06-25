const express = require('express');
const router = express.Router();
const { getConversations, getConversationMessages, getChatbotAnalytics } = require('../controllers/conversationController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/analytics', getChatbotAnalytics);
router.get('/', getConversations);
router.get('/:id/messages', getConversationMessages);

module.exports = router;
