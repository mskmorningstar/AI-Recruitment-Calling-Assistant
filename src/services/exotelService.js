const axios = require('axios');
const elevenLabsService = require('./elevenLabsService');
require('dotenv').config();

/**
 * Exotel Telephony Service — Indian Cloud Telephony (PRIMARY PROVIDER)
 * Account: winit3 | ExoPhone: 08047289025
 * Docs: https://developer.exotel.com/api/
 *
 * How Exotel outbound calls work:
 *  1. POST /Calls/connect.json → Exotel dials candidate
 *  2. When candidate picks up, Exotel GETs your `Url` (passthru webhook)
 *  3. Your server returns XML instructions (play audio, gather speech)
 *  4. StatusCallback fires when call ends with recording URL
 */
class ExotelService {
  constructor() {
    this.accountSid = process.env.EXOTEL_ACCOUNT_SID; // winit3
    this.apiKey     = process.env.EXOTEL_API_KEY;
    this.apiToken   = process.env.EXOTEL_API_TOKEN;
    this.exophone   = process.env.EXOTEL_PHONE_NUMBER || '08047289025';
    this.subdomain  = process.env.EXOTEL_SUBDOMAIN || 'api.exotel.com';
    this.webhookUrl = process.env.EXOTEL_WEBHOOK_URL || 'http://localhost:3000/api/calls/twiml-exotel';
  }

  isConfigured() {
    return Boolean(
      this.accountSid && this.apiKey && this.apiToken && this.exophone &&
      !String(this.accountSid).includes('your_') &&
      !String(this.apiKey).includes('your_')
    );
  }

  get baseUrl() {
    return `https://${this.subdomain}/v1/Accounts/${this.accountSid}`;
  }

  get authHeader() {
    return {
      Authorization: `Basic ${Buffer.from(`${this.apiKey}:${this.apiToken}`).toString('base64')}`,
    };
  }

  /**
   * Initiate outbound call to candidate
   * Exotel dials candidate → on answer → fetches twiml-exotel webhook
   */
  async initiateCall({ candidatePhone, candidateName, jobTitle, callId, callbackBaseUrl }) {
    if (!this.isConfigured()) throw new Error('Exotel credentials not configured.');

    // Public tunnel URL takes priority for webhooks
    const effectiveBase = process.env.PUBLIC_URL || callbackBaseUrl || 'http://localhost:3000';
    const passthruUrl    = `${effectiveBase}/api/calls/twiml-exotel?callId=${callId}&step=0`;
    const statusCallback = `${effectiveBase}/api/calls/webhook-exotel`;

    // Normalize phone: 0 + 10-digit Indian mobile format
    const toPhone = this.normalizePhone(candidatePhone);

    const params = new URLSearchParams({
      From: this.exophone,        // ExoPhone virtual number
      To: toPhone,                // Candidate's verified phone number
      CallerId: this.exophone,    // Caller ID shown on candidate's screen
      Url: passthruUrl,           // Passthru applet URL when call connects
      StatusCallback: statusCallback,
      Record: 'true',
      TimeLimit: '600',           // 10 min max
      TimeOut: '35',              // Ring for 35 seconds before no-answer
    });

    console.log(`[Exotel] Initiating call → To: ${toPhone} | From: ${this.exophone}`);
    console.log(`[Exotel] Passthru Webhook: ${passthruUrl}`);

    try {
      const response = await axios.post(
        `${this.baseUrl}/Calls/connect.json`,
        params.toString(),
        {
          headers: {
            ...this.authHeader,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 20000,
        }
      );

      const call = response.data?.Call;
      if (!call) throw new Error('Exotel API returned unexpected response: ' + JSON.stringify(response.data));

      return {
        callSid: call.Sid,
        status:  call.Status,
        to:      call.To,
        from:    call.From,
        provider: 'exotel',
      };
    } catch (err) {
      const exotelMsg = err.response?.data?.RestException?.Message || err.response?.data?.message || err.message;
      const status = err.response?.status;
      if (status === 403 && exotelMsg.includes('KYC')) {
        throw new Error(`Exotel KYC Pending: ${exotelMsg}. Visit https://my.exotel.com to complete KYC.`);
      }
      throw new Error(`Exotel Connect failed (${status || 'network'}): ${exotelMsg}`);
    }
  }

  /**
   * Get live call status
   */
  async getCallStatus(callSid) {
    const response = await axios.get(
      `${this.baseUrl}/Calls/${callSid}.json`,
      { headers: this.authHeader, timeout: 8000 }
    );
    const call = response.data?.Call;
    return {
      callSid:      call?.Sid,
      status:       call?.Status,
      duration:     call?.Duration,
      startTime:    call?.StartTime,
      endTime:      call?.EndTime,
      recordingUrl: call?.RecordingUrl,
    };
  }

  /**
   * Fetch call recordings
   */
  async getRecordings(callSid) {
    const response = await axios.get(
      `${this.baseUrl}/Calls/${callSid}/Recordings.json`,
      { headers: this.authHeader, timeout: 8000 }
    );
    return (response.data?.RecordingList || []).map(r => ({
      recordingSid: r.Sid,
      url:          r.Uri,
      duration:     r.Duration,
    }));
  }

  /**
   * Generate Exotel-compatible XML for screening call flow
   * Exotel supports: <Say>, <Play>, <Gather>, <Record>, <Hangup>
   */
  generateScreeningXml({ candidateName, jobTitle, companyName, actionUrl, step = '0', audioBaseUrl = null }) {
    const firstName = (candidateName || 'there').split(' ')[0];
    let sayText = '';

    if (step === '0') {
      // Opening greeting → gather interest
      sayText = `Hello ${firstName}! This is Sarah from the recruitment team at ${companyName || 'our company'}. I'm calling about the exciting ${jobTitle || 'open'} position that matches your profile. Are you available for a quick two minute screening right now? Please say Yes, or press 1.`;
      const audioUrl = audioBaseUrl ? `${audioBaseUrl}/api/calls/audio?h=${elevenLabsService.getHash(sayText)}&t=${encodeURIComponent(sayText)}` : null;
      return this._buildGatherXml(sayText, actionUrl, audioUrl);
    }

    if (step === '1') {
      sayText = 'Wonderful! To make sure this role aligns with your expectations, could you tell me your current salary and your expected compensation?';
      const audioUrl = audioBaseUrl ? `${audioBaseUrl}/api/calls/audio?h=${elevenLabsService.getHash(sayText)}&t=${encodeURIComponent(sayText)}` : null;
      return this._buildGatherXml(sayText, actionUrl, audioUrl);
    }

    if (step === '2') {
      sayText = 'Thank you! What is your current notice period or earliest joining date, and do you prefer working remote, hybrid, or from the office?';
      const audioUrl = audioBaseUrl ? `${audioBaseUrl}/api/calls/audio?h=${elevenLabsService.getHash(sayText)}&t=${encodeURIComponent(sayText)}` : null;
      return this._buildGatherXml(sayText, actionUrl, audioUrl);
    }

    if (step === '3') {
      sayText = 'Perfect! Last question: could you briefly highlight your primary technical skills and total years of relevant experience?';
      const audioUrl = audioBaseUrl ? `${audioBaseUrl}/api/calls/audio?h=${elevenLabsService.getHash(sayText)}&t=${encodeURIComponent(sayText)}` : null;
      return this._buildGatherXml(sayText, actionUrl, audioUrl);
    }

    // Final closing
    sayText = `Thank you so much ${firstName}! You sound like a fantastic fit. Our hiring team will review your responses and email you an interview calendar invitation shortly. Have a wonderful day. Goodbye!`;
    const playClosing = audioBaseUrl ? `<Play>${audioBaseUrl}/api/calls/audio?h=${elevenLabsService.getHash(sayText)}&t=${encodeURIComponent(sayText)}</Play>` : '';

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${playClosing}
  <Say voice="female" language="en-IN">${sayText}</Say>
  <Hangup/>
</Response>`;
  }

  _buildGatherXml(sayText, actionUrl, audioUrl = null) {
    const playAudio = audioUrl ? `<Play>${audioUrl}</Play>` : '';

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather action="${actionUrl}" method="POST" input="speech dtmf" timeout="7" speechTimeout="2" language="en-IN" numDigits="1">
    ${playAudio}
    <Say voice="female" language="en-IN">${sayText}</Say>
  </Gather>
  <Say voice="female" language="en-IN">Sorry, I didn't catch that. We will follow up with you by email. Goodbye!</Say>
  <Hangup/>
</Response>`;
  }

  /**
   * Normalize phone number for Exotel (0 + 10-digit Indian mobile)
   */
  normalizePhone(phone) {
    const digits = String(phone).replace(/\D/g, '');
    if (digits.startsWith('91') && digits.length === 12) return '0' + digits.slice(2);
    if (digits.length === 10) return '0' + digits;
    if (digits.length === 11 && digits.startsWith('0')) return digits;
    return digits;
  }

  /**
   * Test API connectivity
   */
  async testConnection() {
    if (!this.isConfigured()) return { status: 'not_configured' };
    try {
      const response = await axios.get(
        `${this.baseUrl}.json`,
        { headers: this.authHeader, timeout: 8000 }
      );
      const acc = response.data?.Account;
      return {
        status: 'connected',
        account: acc?.FriendlyName || this.accountSid,
        exophone: this.exophone,
        kycStatus: acc?.KycStatus || 'unknown',
        billingType: acc?.BillingType || 'prepaid',
      };
    } catch (err) {
      return {
        status: 'error',
        error: err.response?.data || err.message,
        httpStatus: err.response?.status,
      };
    }
  }
}

module.exports = new ExotelService();
