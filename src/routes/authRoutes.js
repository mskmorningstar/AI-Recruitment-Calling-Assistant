const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/authMiddleware');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/demo', authController.demoLogin);
router.get('/me', requireAuth, authController.me);

// Google OAuth routes
router.get('/google/url', authController.getGoogleAuthUrl);
router.get('/google/callback', authController.googleCallback);
router.post('/google/simulate', authController.simulateGoogleAuth);

module.exports = router;
