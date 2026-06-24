const express = require('express');
const businessController = require('../controllers/businessController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

router.post('/setup', businessController.setupBusiness);
router.get('/my-business', businessController.getMyBusiness);
router.put('/update', businessController.updateBusiness);
router.put('/usage-type', businessController.updateUsageType);
router.patch('/:businessId', businessController.updateBusinessWhatsapp);

module.exports = router;
