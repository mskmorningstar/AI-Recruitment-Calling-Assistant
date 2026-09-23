const { query } = require('../config/database');
const atsService = require('../services/atsService');

/**
 * Fetch all jobs
 */
async function getAllJobs(req, res, next) {
  try {
    const result = await query(`SELECT * FROM jobs ORDER BY created_at DESC`);
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get specific job by ID
 */
async function getJobById(req, res, next) {
  try {
    const { id } = req.params;
    const result = await query(`SELECT * FROM jobs WHERE job_id = $1`, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Create a new job manually
 */
async function createJob(req, res, next) {
  try {
    const { title, company_name, location, employment_type, salary_range, jd_text } = req.body;

    if (!title || !company_name) {
      return res.status(400).json({ success: false, error: 'title and company_name are required' });
    }

    const result = await query(`
      INSERT INTO jobs (title, company_name, location, employment_type, salary_range, jd_text)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [title, company_name, location || null, employment_type || 'Full-time', salary_range || null, jd_text || null]);

    res.status(201).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Sync jobs from ATS API (Greenhouse)
 */
async function syncJobsFromAts(req, res, next) {
  try {
    if (!atsService.isConfigured()) {
      return res.status(400).json({
        success: false,
        error: 'Greenhouse ATS API key not configured in .env',
      });
    }

    const jobsFromAts = await atsService.fetchJobs();
    const syncedJobs = [];

    for (const job of jobsFromAts) {
      const resJob = await query(`
        INSERT INTO jobs (title, company_name, location, employment_type, jd_text)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, [job.title, 'Greenhouse Client', job.location, job.employmentType, `Imported from ATS ID: ${job.atsJobId}`]);
      syncedJobs.push(resJob.rows[0]);
    }

    res.json({
      success: true,
      message: `Synced ${syncedJobs.length} jobs from ATS.`,
      data: syncedJobs,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAllJobs,
  getJobById,
  createJob,
  syncJobsFromAts,
};
