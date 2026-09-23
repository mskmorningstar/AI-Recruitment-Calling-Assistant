const express = require('express');
const router = express.Router();
const interviewController = require('../controllers/interviewController');

router.get('/', interviewController.getAllInterviews);
router.get('/availability', interviewController.checkAvailability);
router.post('/schedule', interviewController.scheduleInterview);
router.post('/auto-schedule', interviewController.autoScheduleInterview);
router.post('/quick-book', interviewController.quickBookInterview);
router.patch('/:id', interviewController.updateInterview);
router.delete('/:id', interviewController.cancelInterview);

module.exports = router;
