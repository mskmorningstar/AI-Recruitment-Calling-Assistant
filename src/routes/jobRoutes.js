const express = require('express');
const router = express.Router();
const jobController = require('../controllers/jobController');

router.get('/', jobController.getAllJobs);
router.get('/:id', jobController.getJobById);
router.post('/', jobController.createJob);
router.post('/sync', jobController.syncJobsFromAts);

module.exports = router;
