const express = require('express');
const contactController = require('../controllers/contactController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

router.get('/', contactController.getContacts);
router.post('/', contactController.createContact);
router.post('/import', contactController.importContacts);
router.post('/auto-create', contactController.autoCreateContact);
router.get('/:id', contactController.getContact);
router.put('/:id', contactController.updateContact);
router.delete('/:id', contactController.deleteContact);

module.exports = router;
