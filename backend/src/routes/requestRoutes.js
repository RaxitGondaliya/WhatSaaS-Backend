const express = require('express');
const requestController = require('../controllers/requestController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

router.get('/', requestController.getRequests);
router.post('/', requestController.createRequest);
router.post('/from-chatbot', requestController.createRequestFromChatbot);
router.get('/:id', requestController.getRequest);
router.put('/:id', requestController.updateRequest);
router.put('/:id/status', requestController.updateRequestStatus);
router.put('/:id/complete', requestController.completeRequest);
router.put('/:id/mark-paid', requestController.markRequestPaid);
router.post('/:id/notes', requestController.addInternalNote);
router.put('/:id/cancel', requestController.cancelRequest);

module.exports = router;
