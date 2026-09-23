const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');

router.get('/transcripts', analyticsController.getTranscriptReports);

module.exports = router;
