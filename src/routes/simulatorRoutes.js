/**
 * Browser Voice Simulator API
 * Provides 3 lightweight endpoints used by the in-browser voice call simulator:
 *   POST /api/simulator/speak            — ElevenLabs TTS → returns audio buffer
 *   POST /api/simulator/transcribe       — AssemblyAI STT for uploaded audio blob
 *   POST /api/simulator/append-transcript— Appends simulated transcript to call session
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const os = require('os');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { AssemblyAI } = require('assemblyai');
const { query } = require('../config/database');
require('dotenv').config();

const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 25 * 1024 * 1024 } });

const elevenLabsService = require('../services/elevenLabsService');

// ─── ElevenLabs TTS: returns audio buffer for browser playback ────────────────
router.post('/speak', async (req, res) => {
  const { text, voiceId } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });

  if (!elevenLabsService.isConfigured()) {
    return res.status(503).json({ error: 'ElevenLabs API key not configured' });
  }

  try {
    const audioBuffer = await elevenLabsService.generateSpeech({ text, voiceId, useCache: true });
    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(audioBuffer);
  } catch (err) {
    console.error('[Simulator/Speak] ElevenLabs error:', err.response?.data ? Buffer.from(err.response.data).toString() : err.message);
    res.status(502).json({ error: 'ElevenLabs TTS failed: ' + err.message });
  }
});

// ─── AssemblyAI STT: transcribe uploaded audio blob ───────────────────────────
router.post('/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'audio file required' });

  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  const filePath = req.file.path;

  try {
    if (!apiKey || apiKey.includes('your_')) {
      fs.unlinkSync(filePath);
      return res.json({ text: '' });
    }

    const aai = new AssemblyAI({ apiKey });

    // Upload the audio file to AssemblyAI
    const uploadResponse = await axios.post(
      'https://api.assemblyai.com/v2/upload',
      fs.createReadStream(filePath),
      {
        headers: {
          authorization: apiKey,
          'Transfer-Encoding': 'chunked',
        },
        timeout: 20000,
      }
    );

    const audioUrl = uploadResponse.data.upload_url;
    fs.unlinkSync(filePath);

    // Transcribe
    const transcript = await aai.transcripts.transcribe({ audio_url: audioUrl });

    res.json({ text: transcript.text || '', confidence: transcript.confidence });
  } catch (err) {
    try { fs.unlinkSync(filePath); } catch {}
    console.error('[Simulator/Transcribe] Error:', err.message);
    res.json({ text: '', error: err.message });
  }
});

// ─── Append live transcript to call_sessions ──────────────────────────────────
router.post('/append-transcript', async (req, res) => {
  const { callId, text } = req.body;
  if (!callId || !text) return res.status(400).json({ error: 'callId and text required' });

  try {
    await query(
      'UPDATE call_sessions SET transcript_text = $1 WHERE call_id = $2',
      [text, callId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
