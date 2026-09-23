const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

class ElevenLabsService {
  constructor() {
    this.apiKey = process.env.ELEVENLABS_API_KEY;
    // Default to Sarah (premade voice supported on free tier)
    this.voiceId = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
    this.modelId = process.env.ELEVENLABS_MODEL_ID || 'eleven_flash_v2_5';
    this.baseUrl = 'https://api.elevenlabs.io/v1';

    // Ensure audio cache directory exists
    this.cacheDir = path.resolve(process.env.AUDIO_CACHE_DIR || './data/audio_cache');
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  isConfigured() {
    return Boolean(this.apiKey && !this.apiKey.includes('your_'));
  }

  /**
   * Compute deterministic cache hash for text + voiceId
   */
  getHash(text, voiceId) {
    const v = voiceId || this.voiceId;
    return crypto.createHash('sha256').update(`${v}:${text.trim()}`).digest('hex').slice(0, 24);
  }

  /**
   * Get cached file path by hash
   */
  getFilePath(hash) {
    return path.join(this.cacheDir, `${hash}.mp3`);
  }

  /**
   * Check if audio is already cached
   */
  isAudioCached(hash) {
    const filePath = this.getFilePath(hash);
    return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
  }

  /**
   * Get cached audio buffer by hash
   */
  getCachedAudio(hash) {
    const filePath = this.getFilePath(hash);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath);
    }
    return null;
  }

  /**
   * Synthesize high-quality dynamic speech with automatic disk caching
   */
  async generateSpeech({ text, voiceId, useCache = true }) {
    if (!text) throw new Error('Text is required for speech synthesis.');

    const selectedVoice = voiceId || this.voiceId;
    const hash = this.getHash(text, selectedVoice);
    const filePath = this.getFilePath(hash);

    // 1. Return from disk cache if present to preserve monthly quota
    if (useCache && this.isAudioCached(hash)) {
      // console.log(`[ElevenLabs Cache] Cache hit for hash: ${hash}`);
      return fs.readFileSync(filePath);
    }

    if (!this.isConfigured()) {
      throw new Error('ElevenLabs API Key is not configured in environment variables.');
    }

    // 2. Synthesize via ElevenLabs API
    const modelsToTry = [this.modelId, 'eleven_multilingual_v2'];
    let lastError = null;

    for (const model of modelsToTry) {
      try {
        const response = await axios.post(
          `${this.baseUrl}/text-to-speech/${selectedVoice}`,
          {
            text,
            model_id: model,
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
            },
          },
          {
            headers: {
              'xi-api-key': this.apiKey,
              'Content-Type': 'application/json',
              'Accept': 'audio/mpeg',
            },
            responseType: 'arraybuffer',
            timeout: 15000,
          }
        );

        const buffer = Buffer.from(response.data);

        // Save to cache
        if (useCache && buffer.length > 0) {
          try {
            fs.writeFileSync(filePath, buffer);
            console.log(`[ElevenLabs Cache] Saved audio for: "${text.slice(0, 30)}..." [${hash}] (${buffer.length} bytes)`);
          } catch (writeErr) {
            console.warn('[ElevenLabs Cache] Failed to write cache file:', writeErr.message);
          }
        }

        return buffer;
      } catch (err) {
        lastError = err;
        const msg = err.response?.data ? Buffer.from(err.response.data).toString() : err.message;
        console.warn(`[ElevenLabs] Attempt with model ${model} failed: ${msg}`);
      }
    }

    throw lastError || new Error('ElevenLabs speech synthesis failed across all candidate models.');
  }

  /**
   * Synthesize and return hash info for TwiML / Exotel <Play> URL generation
   */
  async preWarmAudio({ text, voiceId }) {
    const selectedVoice = voiceId || this.voiceId;
    const hash = this.getHash(text, selectedVoice);

    if (this.isAudioCached(hash)) {
      return { hash, cached: true };
    }

    if (this.isConfigured()) {
      try {
        await this.generateSpeech({ text, voiceId: selectedVoice, useCache: true });
        return { hash, cached: true };
      } catch (err) {
        console.warn(`[ElevenLabs Pre-Warm] Could not pre-cache audio: ${err.message}`);
      }
    }

    return { hash, cached: false };
  }

  /**
   * Fetch available voices from ElevenLabs
   */
  async getVoices() {
    if (!this.isConfigured()) {
      throw new Error('ElevenLabs API Key is not configured.');
    }

    const response = await axios.get(`${this.baseUrl}/voices`, {
      headers: {
        'xi-api-key': this.apiKey,
      },
    });

    return response.data.voices;
  }
}

module.exports = new ElevenLabsService();
