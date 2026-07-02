const express = require('express');
const chatbotFlowController = require('../controllers/chatbotFlowController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

router.get('/', chatbotFlowController.getFlows);
router.post('/', chatbotFlowController.createFlow);
router.get('/:id', chatbotFlowController.getFlow);
router.put('/:id', chatbotFlowController.updateFlow);
router.put('/:id/activate', chatbotFlowController.activateFlow);
router.post('/:flowId/nodes', chatbotFlowController.addNode);
router.delete('/:flowId/nodes/:nodeId', chatbotFlowController.deleteNode);
router.delete('/:id', chatbotFlowController.deleteFlow);
router.get('/:flowId/deduplicate', chatbotFlowController.deduplicateNodes);

module.exports = router;
