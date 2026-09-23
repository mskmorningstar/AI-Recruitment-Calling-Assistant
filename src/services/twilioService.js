const twilio = require('twilio');
require('dotenv').config();

class TwilioService {
  constructor() {
    this.accountSid = process.env.TWILIO_ACCOUNT_SID;
    this.authToken = process.env.TWILIO_AUTH_TOKEN;
    this.fromNumber = process.env.TWILIO_PHONE_NUMBER;
    this.webhookUrl = process.env.TWILIO_WEBHOOK_URL;

    if (this.accountSid && this.authToken && !this.accountSid.includes('your_')) {
      this.client = twilio(this.accountSid, this.authToken);
    } else {
      this.client = null;
    }
  }

  isConfigured() {
    return Boolean(this.client);
  }

  /**
   * Initiate an outbound call to candidate
   */
  async initiateCall({ candidatePhone, candidateName, jobTitle, callId, callbackBaseUrl }) {
    if (!this.isConfigured()) {
      throw new Error('Twilio credentials not configured in environment variables.');
    }

    const webhookUrl = `${callbackBaseUrl || this.webhookUrl || 'http://localhost:3000'}/api/calls/webhook`;
    const twimlUrl = `${callbackBaseUrl || this.webhookUrl || 'http://localhost:3000'}/api/calls/twiml?callId=${callId}`;

    const call = await this.client.calls.create({
      to: candidatePhone,
      from: this.fromNumber,
      url: twimlUrl,
      statusCallback: webhookUrl,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST',
      record: true, // Auto-record call for post-call transcription & compliance
    });

    return {
      callSid: call.sid,
      status: call.status,
      direction: call.direction,
      to: call.to,
      from: call.from,
    };
  }

  /**
   * Fetch call status directly from Twilio
   */
  async getCallStatus(callSid) {
    if (!this.isConfigured()) {
      throw new Error('Twilio credentials not configured.');
    }
    const call = await this.client.calls(callSid).fetch();
    return {
      callSid: call.sid,
      status: call.status,
      duration: call.duration,
      startTime: call.startTime,
      endTime: call.endTime,
    };
  }

  /**
   * Fetch call recording from Twilio
   */
  async getCallRecordings(callSid) {
    if (!this.isConfigured()) {
      throw new Error('Twilio credentials not configured.');
    }
    const recordings = await this.client.recordings.list({ callSid, limit: 5 });
    return recordings.map(rec => ({
      recordingSid: rec.sid,
      duration: rec.duration,
      url: `https://api.twilio.com${rec.uri.replace('.json', '.mp3')}`,
      status: rec.status,
      dateCreated: rec.dateCreated,
    }));
  }

  /**
   * Build interactive screening TwiML for multi-turn dialogue
   */
  generateScreeningTwiML({ candidateName, companyName, jobTitle, actionUrl, step = '0', audioBaseUrl = null }) {
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();
    const elevenLabsService = require('./elevenLabsService');
    const firstName = (candidateName || 'there').split(' ')[0];

    let sayText = '';

    if (step === '0') {
      sayText = `Hello ${firstName}! This is Sarah from the recruitment team at ${companyName || 'our company'}. I'm calling about the exciting ${jobTitle || 'open'} position that matches your background. Do you have two minutes for a brief screening conversation? Please say Yes, or press 1.`;
    } else if (step === '1') {
      sayText = 'Wonderful! To ensure alignment, could you share your current compensation and your expected salary range?';
    } else if (step === '2') {
      sayText = 'Thank you! What is your current notice period or earliest joining date, and do you prefer remote, hybrid, or onsite work?';
    } else if (step === '3') {
      sayText = 'Perfect! Last question: could you briefly highlight your primary technical skills and total years of relevant experience?';
    } else {
      // Closing
      sayText = `Thank you so much ${firstName}! You sound like a fantastic fit. Our hiring team will review your notes and email you an interview calendar invitation shortly. Have a wonderful day!`;
      const hash = elevenLabsService.getHash(sayText);
      if (audioBaseUrl) {
        response.play(`${audioBaseUrl}/api/calls/audio?h=${hash}&t=${encodeURIComponent(sayText)}`);
      }
      response.say({ voice: 'Polly.Joanna-Neural' }, sayText);
      response.hangup();
      return response.toString();
    }

    const hash = elevenLabsService.getHash(sayText);
    const gather = response.gather({
      input: 'speech dtmf',
      action: actionUrl,
      method: 'POST',
      speechTimeout: 'auto',
      timeout: 6,
      numDigits: 1,
    });

    if (audioBaseUrl) {
      gather.play(`${audioBaseUrl}/api/calls/audio?h=${hash}&t=${encodeURIComponent(sayText)}`);
    }
    gather.say({ voice: 'Polly.Joanna-Neural' }, sayText);

    response.say({ voice: 'Polly.Joanna-Neural' }, "Sorry, I didn't hear a response. We'll follow up with you by email. Goodbye!");
    response.hangup();

    return response.toString();
  }
}

module.exports = new TwilioService();
