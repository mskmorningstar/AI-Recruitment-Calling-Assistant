const fetch = require('node-fetch');
require('dotenv').config();

/**
 * Vapi.ai Service — AI-native telephony, no KYC required
 * Docs: https://docs.vapi.ai
 *
 * How Vapi works:
 *  1. You POST to /call/phone → Vapi dials the candidate
 *  2. Vapi runs its own AI voice agent (or your assistant config)
 *  3. Vapi sends webhooks for call events (started, ended, transcript)
 *  4. We store the call result + transcript in our DB
 */
class VapiService {
  constructor() {
    this.apiKey      = process.env.VAPI_API_KEY;
    this.phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID; // from Vapi dashboard
    this.assistantId   = process.env.VAPI_ASSISTANT_ID;    // optional — use inline config if not set
    this.baseUrl       = 'https://api.vapi.ai';
  }

  isConfigured() {
    return Boolean(this.apiKey && this.phoneNumberId && !this.apiKey.includes('your_'));
  }

  /**
   * Initiate an outbound call via Vapi
   * Vapi will dial the candidate and run the AI recruiter conversation
   */
  async initiateCall({ candidatePhone, candidateName, jobTitle, callId, callbackBaseUrl }) {
    if (!this.isConfigured()) {
      throw new Error('Vapi credentials not configured. Set VAPI_API_KEY and VAPI_PHONE_NUMBER_ID in .env');
    }

    const webhookUrl = `${callbackBaseUrl || 'http://localhost:3000'}/api/calls/vapi-webhook`;
    const firstName = (candidateName || 'there').split(' ')[0];

    // Normalize phone to E.164 format required by Vapi
    let normalizedPhone = (candidatePhone || '').replace(/[\s\-\(\)]/g, '');
    if (!normalizedPhone.startsWith('+')) {
      if (normalizedPhone.startsWith('0') && normalizedPhone.length === 11) {
        normalizedPhone = '+91' + normalizedPhone.slice(1);
      } else if (normalizedPhone.length === 10) {
        normalizedPhone = '+91' + normalizedPhone;
      } else {
        normalizedPhone = '+' + normalizedPhone;
      }
    }

    // Build the call payload — either point to a saved assistant or define inline
    const payload = {
      phoneNumberId: this.phoneNumberId,
      customer: {
        number: normalizedPhone,
        name: candidateName || 'Candidate',
      },
      ...(this.assistantId
        // ── Option A: Use a pre-saved assistant from Vapi dashboard ──────
        ? {
            assistantId: this.assistantId,
            assistantOverrides: {
              serverUrl: webhookUrl,
              variableValues: {
                candidateName: firstName,
                jobTitle: jobTitle || 'the open position',
              },
            },
          }
        // ── Option B: Define the assistant inline (no dashboard setup needed) ──
        : {
            assistant: {
              name: 'Sarah — AI Recruiter',
              model: {
                provider: 'groq',
                model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
                // Falls back to OpenAI if Groq key not set
                ...(process.env.GROQ_API_KEY
                  ? { groqApiKey: process.env.GROQ_API_KEY }
                  : {}),
                messages: [
                  {
                    role: 'system',
                    content: `You are Sarah, a professional AI recruiter at Winit. 
You are conducting a brief phone screening for the role of "${jobTitle || 'Software Engineer'}".

Your goal is to collect the following information from ${firstName}:
1. Their interest in the role (ask first)
2. Current salary and expected compensation
3. Notice period and work preference (remote/hybrid/on-site)
4. Primary skills and years of experience

Be conversational, warm, and professional. Keep questions short and clear.
After collecting all responses, thank the candidate and let them know the team will review and send a calendar invite.

Do not make up information. Do not discuss things outside of recruitment.`,
                  },
                ],
              },
              voice: {
                provider: 'elevenlabs',
                voiceId: process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL',
                ...(process.env.ELEVENLABS_API_KEY
                  ? { elevenlabsApiKey: process.env.ELEVENLABS_API_KEY }
                  : {}),
              },
              firstMessage: `Hello ${firstName}! This is Sarah from the recruitment team at Winit. I'm calling about the ${jobTitle || 'open position'} that matches your profile. Do you have two minutes for a quick screening?`,
              endCallMessage: `Thank you so much, ${firstName}! Our team will review your profile and send you an interview invitation shortly. Have a great day!`,
              transcriber: {
                provider: 'assembly-ai',
                ...(process.env.ASSEMBLYAI_API_KEY
                  ? { assemblyAiApiKey: process.env.ASSEMBLYAI_API_KEY }
                  : {}),
              },
              serverUrl: webhookUrl,
              serverUrlSecret: process.env.VAPI_WEBHOOK_SECRET || '',
              recordingEnabled: true,
              endCallFunctionEnabled: true,
              metadata: {
                callId,          // our internal DB call ID — returned in webhooks
                candidateName,
                jobTitle,
              },
            },
          }),
    };

    const res = await fetch(`${this.baseUrl}/call/phone`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      let parsedErr = {};
      try { parsedErr = JSON.parse(errText); } catch(e) {}
      if (res.status === 401 && (parsedErr.message?.includes('private key') || errText.includes('private key'))) {
        throw new Error('Vapi Auth Error: You provided Vapi\'s "Public Key" in VAPI_API_KEY. Backend calls require the "Private API Key". Go to https://dashboard.vapi.ai/org/api-keys, click "+ Create Key" under Private API Keys, and paste it into .env.');
      }
      throw new Error(`Vapi API error ${res.status}: ${parsedErr.message || errText}`);
    }

    const data = await res.json();

    return {
      callSid: data.id,          // Vapi call ID
      status: data.status || 'queued',
      to: candidatePhone,
      from: data.phoneNumber?.number || this.phoneNumberId,
      provider: 'vapi',
    };
  }

  /**
   * Fetch call details from Vapi (status, recording, transcript)
   */
  async getCallStatus(vapiCallId) {
    if (!this.isConfigured()) throw new Error('Vapi not configured.');

    const res = await fetch(`${this.baseUrl}/call/${vapiCallId}`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
    });
    if (!res.ok) throw new Error(`Vapi getCallStatus error: ${res.status}`);

    const data = await res.json();
    return {
      callSid: data.id,
      status: data.status,
      duration: data.duration,
      transcript: data.transcript,
      recordingUrl: data.recordingUrl,
      summary: data.summary,
      startedAt: data.startedAt,
      endedAt: data.endedAt,
    };
  }

  /**
   * Parse Vapi webhook payload and extract relevant fields
   * Called from callRoutes when POST /api/calls/vapi-webhook fires
   */
  parseWebhook(body) {
    const type = body.message?.type || body.type;
    const call = body.message?.call || body.call || {};

    return {
      type,                                        // 'call-started' | 'call-ended' | 'transcript' | 'hang' | 'function-call'
      vapiCallId: call.id,
      internalCallId: call.metadata?.callId,       // our DB call_id
      status: call.status,
      transcript: body.message?.transcript || body.transcript || null,
      recordingUrl: call.recordingUrl || null,
      endedReason: call.endedReason || null,
      durationSeconds: call.duration || null,
      summary: body.message?.analysis?.summary || null,
      structuredData: body.message?.analysis?.structuredData || null,
    };
  }

  /**
   * List all phone numbers available on your Vapi account
   */
  async listPhoneNumbers() {
    if (!this.isConfigured()) throw new Error('Vapi not configured.');
    const res = await fetch(`${this.baseUrl}/phone-number`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
    });
    if (!res.ok) throw new Error(`Vapi listPhoneNumbers error: ${res.status}`);
    return res.json();
  }
}

module.exports = new VapiService();
