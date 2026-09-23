const Groq = require('groq-sdk');
require('dotenv').config();

class NlpService {
  constructor() {
    this.groqKey = process.env.GROQ_API_KEY;
    this.model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

    if (this.groqKey && !this.groqKey.includes('your_')) {
      this.groq = new Groq({ apiKey: this.groqKey });
      this.provider = 'groq';
      console.log(`[NLP] Groq (${this.model}) configured — FREE tier active`);
    } else {
      this.groq = null;
      this.provider = 'regex';
      console.log('[NLP] No LLM configured — using built-in regex extraction');
    }
  }

  isConfigured() {
    return true; // Always works — regex fallback always available
  }

  /**
   * Extract structured screening data from transcript
   * Uses Groq (free) if configured, otherwise regex-based fallback
   */
  async extractResponses({ transcriptText, jobDescription }) {
    if (this.groq) {
      return this._extractWithGroq(transcriptText, jobDescription);
    }
    return this._extractWithRegex(transcriptText);
  }

  async _extractWithGroq(transcriptText, jobDescription) {
    const systemPrompt = `You are an expert recruitment NLP extraction engine.
Given the call transcript, extract structured candidate screening data.
Return ONLY a valid JSON object with this exact schema:
{
  "confidenceScore": number (0.00 to 1.00),
  "isInterested": boolean,
  "summary": "one sentence summary",
  "responses": [
    { "questionCode": "CURRENT_SALARY", "rawText": "...", "normalizedValue": "..." },
    { "questionCode": "EXPECTED_SALARY", "rawText": "...", "normalizedValue": "..." },
    { "questionCode": "NOTICE_PERIOD", "rawText": "...", "normalizedValue": "..." },
    { "questionCode": "SKILLS_CONFIRMATION", "rawText": "...", "normalizedValue": "..." },
    { "questionCode": "LOCATION", "rawText": "...", "normalizedValue": "..." },
    { "questionCode": "WORK_PREFERENCES", "rawText": "...", "normalizedValue": "Remote|Hybrid|Onsite" }
  ]
}`;

    const completion = await this.groq.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Job Description:\n${jobDescription || 'N/A'}\n\nTranscript:\n${transcriptText}` }
      ],
      temperature: 0.1,
      max_tokens: 800,
      response_format: { type: 'json_object' },
    });

    const content = completion.choices[0].message.content;
    return JSON.parse(content);
  }

  _extractWithRegex(text) {
    const lower = text.toLowerCase();

    // Salary extraction
    const salaryMatch = text.match(/(\d[\d,]*\s*(?:lpa|lakhs?|lakh|k|thousand|per\s*(?:month|annum|year)))/gi) || [];
    const currentSalary = salaryMatch[0] || 'Not mentioned';
    const expectedSalary = salaryMatch[1] || salaryMatch[0] || 'Not mentioned';

    // Notice period
    const noticeMatch = text.match(/(\d+)\s*(?:days?|weeks?|months?)\s*(?:notice|serving)?/i);
    const noticePeriod = noticeMatch ? noticeMatch[0] : (lower.includes('immediate') ? 'Immediate' : 'Not mentioned');

    // Work preference
    let workPref = 'Not mentioned';
    if (lower.includes('remote')) workPref = 'Remote';
    else if (lower.includes('hybrid')) workPref = 'Hybrid';
    else if (lower.includes('onsite') || lower.includes('office')) workPref = 'Onsite';

    // Interest
    const isInterested = !lower.includes('not interested') && !lower.includes('no thanks') &&
      (lower.includes('yes') || lower.includes('sure') || lower.includes('interested') || lower.includes('okay'));

    return {
      confidenceScore: 0.65,
      isInterested,
      summary: `Candidate screening data extracted via regex from transcript (${text.split(' ').length} words).`,
      responses: [
        { questionCode: 'CURRENT_SALARY', rawText: currentSalary, normalizedValue: currentSalary },
        { questionCode: 'EXPECTED_SALARY', rawText: expectedSalary, normalizedValue: expectedSalary },
        { questionCode: 'NOTICE_PERIOD', rawText: noticePeriod, normalizedValue: noticePeriod },
        { questionCode: 'SKILLS_CONFIRMATION', rawText: 'Extracted from transcript', normalizedValue: 'Confirmed' },
        { questionCode: 'LOCATION', rawText: 'Not extracted', normalizedValue: 'Not mentioned' },
        { questionCode: 'WORK_PREFERENCES', rawText: workPref, normalizedValue: workPref },
      ],
    };
  }

  /**
   * Answer candidate FAQ during a call, grounded in the job description
   */
  async answerCandidateQuestion({ question, jobDescription, companyName }) {
    if (this.groq) {
      const completion = await this.groq.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You are a friendly AI recruiter for ${companyName || 'our company'}. Answer the candidate question in 1-2 short sentences based ONLY on the job description. If info is unavailable, say you'll note it for the hiring manager.`
          },
          {
            role: 'user',
            content: `Job Description:\n${jobDescription}\n\nCandidate Question: ${question}`
          }
        ],
        temperature: 0.3,
        max_tokens: 120,
      });
      return completion.choices[0].message.content.trim();
    }
    return `Thank you for your question about ${question}. I'll make sure to pass that along to the hiring manager who can give you a complete answer.`;
  }

  /**
   * Test Groq connection
   */
  async testConnection() {
    if (!this.groq) return { provider: 'regex', status: 'active', model: 'built-in' };
    try {
      const res = await this.groq.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: 'Say "Groq ready" in exactly 2 words.' }],
        max_tokens: 10,
      });
      return { provider: 'groq', status: 'active', model: this.model, response: res.choices[0].message.content.trim() };
    } catch (err) {
      return { provider: 'groq', status: 'error', error: err.message };
    }
  }
}

module.exports = new NlpService();
