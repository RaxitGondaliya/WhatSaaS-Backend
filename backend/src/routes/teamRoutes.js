const express = require('express');
const teamController = require('../controllers/teamController');
const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

router.post('/', authorize('owner', 'admin'), teamController.createMember);
router.get('/', authorize('owner', 'admin', 'manager'), teamController.getMembers);
router.put('/:id/status', authorize('owner', 'admin'), teamController.updateMemberStatus);
router.put('/:id', authorize('owner', 'admin'), teamController.updateMember);
router.put('/:id/access', authorize('owner', 'admin'), teamController.updateMemberAccess);
router.put('/:id/reset-password', authorize('owner', 'admin'), teamController.resetMemberPassword);
router.delete('/:id', authorize('owner', 'admin'), teamController.deleteMember);

module.exports = router;
