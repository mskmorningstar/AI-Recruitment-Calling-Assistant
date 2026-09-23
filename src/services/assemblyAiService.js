const { AssemblyAI } = require('assemblyai');
require('dotenv').config();

class AssemblyAiService {
  constructor() {
    this.apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (this.apiKey && !this.apiKey.includes('your_')) {
      this.client = new AssemblyAI({ apiKey: this.apiKey });
    } else {
      this.client = null;
    }
  }

  isConfigured() {
    return Boolean(this.client);
  }

  /**
   * Transcribe an audio URL (e.g. from Twilio recording)
   */
  async transcribeAudio(audioUrl) {
    if (!this.isConfigured()) {
      throw new Error('AssemblyAI API Key is not configured in environment variables.');
    }

    const transcript = await this.client.transcripts.transcribe({
      audio_url: audioUrl,
      speaker_labels: true,
      punctuate: true,
      format_text: true,
    });

    if (transcript.status === 'error') {
      throw new Error(`AssemblyAI Transcription failed: ${transcript.error}`);
    }

    return {
      id: transcript.id,
      text: transcript.text,
      confidence: transcript.confidence,
      utterances: transcript.utterances,
      audioDuration: transcript.audio_duration,
    };
  }

  /**
   * Retrieve an existing transcript by ID
   */
  async getTranscript(transcriptId) {
    if (!this.isConfigured()) {
      throw new Error('AssemblyAI API Key is not configured.');
    }
    return await this.client.transcripts.get(transcriptId);
  }
}

module.exports = new AssemblyAiService();
