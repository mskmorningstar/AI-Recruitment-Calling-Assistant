const express = require('express');
const router = express.Router();
const resumeController = require('../controllers/resumeController');

// Parse a single PDF resume and return AI-extracted profile
router.post(
  '/parse',
  resumeController.upload.single('resume'),
  resumeController.parseResume
);

// Save extracted profile as a candidate in the database
router.post('/add-candidate', resumeController.addCandidateFromResume);

module.exports = router;
