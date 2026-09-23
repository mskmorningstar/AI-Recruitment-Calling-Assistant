const express = require('express');
const router = express.Router();
const multer = require('multer');
const os = require('os');
const path = require('path');
const candidateController = require('../controllers/candidateController');

// Configure multer for CSV upload
const upload = multer({
  dest: path.join(os.tmpdir(), 'csv_uploads'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  }
});

router.get('/', candidateController.getAllCandidates);
router.get('/:id', candidateController.getCandidateById);
router.post('/upload', upload.single('candidates'), candidateController.uploadCandidatesCsv);
// Also accept file field named 'file'
router.post('/upload-csv', upload.single('file'), candidateController.uploadCandidatesCsv);
router.patch('/:id', candidateController.updateCandidate);
router.delete('/:id', candidateController.deleteCandidate);

module.exports = router;
