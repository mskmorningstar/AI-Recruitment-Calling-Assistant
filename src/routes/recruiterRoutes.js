const express = require('express');
const router = express.Router();
const recruiterController = require('../controllers/recruiterController');

router.get('/', recruiterController.getAllRecruiters);
router.post('/', recruiterController.createRecruiter);
router.patch('/:id', recruiterController.updateRecruiter);

module.exports = router;
