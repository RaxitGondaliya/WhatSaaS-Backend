const express = require('express');
const broadcastCampaignController = require('../controllers/broadcastCampaignController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

router.get('/', broadcastCampaignController.getCampaigns);
router.post('/', broadcastCampaignController.createCampaign);
router.get('/:id', broadcastCampaignController.getCampaign);
router.put('/:id', broadcastCampaignController.updateCampaign);
router.delete('/:id', broadcastCampaignController.deleteCampaign);
router.put('/:id/schedule', broadcastCampaignController.scheduleCampaign);
router.put('/:id/save-draft', broadcastCampaignController.saveDraft);
router.put('/:id/cancel', broadcastCampaignController.cancelCampaign);

module.exports = router;
