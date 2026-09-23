const axios = require('axios');
require('dotenv').config();

class AtsService {
  constructor() {
    this.apiKey = process.env.GREENHOUSE_API_KEY;
    this.baseUrl = process.env.GREENHOUSE_BASE_URL || 'https://harvest.greenhouse.io/v1';
  }

  isConfigured() {
    return Boolean(this.apiKey && !this.apiKey.includes('your_'));
  }

  getAuthHeader() {
    if (!this.apiKey) return {};
    const token = Buffer.from(`${this.apiKey}:`).toString('base64');
    return { Authorization: `Basic ${token}` };
  }

  /**
   * Fetch candidates from Greenhouse ATS API
   */
  async fetchCandidates(perPage = 25) {
    if (!this.isConfigured()) {
      throw new Error('ATS API Key (Greenhouse) is not configured in environment variables.');
    }

    const response = await axios.get(`${this.baseUrl}/candidates`, {
      params: { per_page: perPage },
      headers: this.getAuthHeader(),
      timeout: 10000,
    });

    return response.data.map(item => ({
      atsId: String(item.id),
      fullName: `${item.first_name || ''} ${item.last_name || ''}`.trim(),
      email: item.email_addresses?.[0]?.value || '',
      phoneNumber: item.phone_numbers?.[0]?.value || '',
      source: 'Greenhouse',
    }));
  }

  /**
   * Fetch jobs from Greenhouse ATS API
   */
  async fetchJobs() {
    if (!this.isConfigured()) {
      throw new Error('ATS API Key (Greenhouse) is not configured in environment variables.');
    }

    const response = await axios.get(`${this.baseUrl}/jobs`, {
      headers: this.getAuthHeader(),
      timeout: 10000,
    });

    return response.data.map(job => ({
      atsJobId: String(job.id),
      title: job.name,
      location: job.offices?.[0]?.name || 'Remote',
      employmentType: job.employment_type || 'Full-time',
    }));
  }

  /**
   * Sync screening notes back to candidate profile in Greenhouse
   */
  async syncScreeningNote(candidateAtsId, noteText) {
    if (!this.isConfigured()) {
      throw new Error('ATS API Key is not configured.');
    }

    const response = await axios.post(
      `${this.baseUrl}/candidates/${candidateAtsId}/activity_feed/notes`,
      {
        body: noteText,
        visibility: 'admin_only',
      },
      {
        headers: this.getAuthHeader(),
      }
    );

    return response.data;
  }
}

module.exports = new AtsService();
