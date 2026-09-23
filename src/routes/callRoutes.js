const express = require('express');
const router = express.Router();
const callController = require('../controllers/callController');
const { callInitiateLimiter } = require('../middleware/rateLimiter');

// ─── Core ─────────────────────────────────────────────────────────────────────
router.get('/', callController.getAllCalls);
router.post('/initiate', callInitiateLimiter, callController.initiateCall);
router.post('/direct-call', callInitiateLimiter, callController.directCall);
router.get('/:id/status', callController.getCallStatus);
router.get('/:id/recording', callController.getCallRecording);
router.get('/:id/transcript', callController.getCallTranscript);
router.post('/:id/process-nlp', callController.processNlpForCall);

// ─── Twilio Webhooks ──────────────────────────────────────────────────────────
router.post('/webhook', callController.handleTwilioWebhook);
router.post('/twiml', callController.generateCallTwiML);
router.post('/gather', callController.handleSpeechGather);

// ─── Exotel Webhooks ──────────────────────────────────────────────────────────
router.post('/webhook-exotel', callController.handleExotelWebhook);
router.get('/twiml-exotel', callController.generateExotelXml);   // Exotel GETs this
router.post('/twiml-exotel', callController.generateExotelXml);  // some Exotel configs POST
router.post('/gather-exotel', callController.handleExotelGather);

// ─── Vapi Webhooks ────────────────────────────────────────────────────────────
router.post('/vapi-webhook', callController.handleVapiWebhook);

// ─── Dynamic ElevenLabs Voice Audio Stream ──────────────────────────────────
router.get('/audio', callController.streamCallAudio);
router.get('/audio/:hash', callController.streamCallAudio);

module.exports = router;
