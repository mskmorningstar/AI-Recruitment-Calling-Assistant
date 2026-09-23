const { query, pool } = require('../config/database');

async function seedData() {
  console.log('[Seed] Seeding initial recruitment data...');
  try {
    // 1. Recruiter
    const recruiterCheck = await query('SELECT COUNT(*) AS count FROM recruiters');
    if (parseInt(recruiterCheck.rows[0].count, 10) === 0) {
      await query(`
        INSERT INTO recruiters (full_name, phone_number, email, company_name)
        VALUES ($1, $2, $3, $4)
      `, ['Sarah Jenkins', '+14155552671', 'sarah.jenkins@techcorp.io', 'TechCorp International']);
      console.log('[Seed] Seeded default recruiter: Sarah Jenkins');
    }

    // 2. Jobs
    const jobCheck = await query('SELECT COUNT(*) AS count FROM jobs');
    let jobId;
    if (parseInt(jobCheck.rows[0].count, 10) === 0) {
      const jobRes = await query(`
        INSERT INTO jobs (title, company_name, location, employment_type, salary_range, jd_text)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING job_id
      `, [
        'Senior Full Stack Engineer',
        'TechCorp International',
        'San Francisco, CA (Hybrid)',
        'Full-time',
        '$140,000 - $180,000 USD',
        'We are seeking an experienced Senior Full Stack Engineer proficient in Node.js, React, and PostgreSQL. Responsibilities include architecting scalable distributed microservices, mentoring junior engineers, and collaborating with cross-functional product teams. Requirements: 5+ years experience, solid cloud architecture knowledge, and strong communication skills.'
      ]);
      jobId = jobRes.rows[0].job_id;
      console.log('[Seed] Seeded default job: Senior Full Stack Engineer');
    } else {
      const existingJob = await query('SELECT job_id FROM jobs LIMIT 1');
      jobId = existingJob.rows[0].job_id;
    }

    // 3. Candidate
    const candCheck = await query('SELECT COUNT(*) AS count FROM candidates');
    if (parseInt(candCheck.rows[0].count, 10) === 0) {
      await query(`
        INSERT INTO candidates (full_name, phone_number, email, source, ats_id)
        VALUES ($1, $2, $3, $4, $5)
      `, ['Alex Mercer', '+15551234567', 'alex.mercer@example.com', 'ATS', 'GH-89412']);
      console.log('[Seed] Seeded default candidate: Alex Mercer');
    }

    console.log('[Seed] Seeding completed successfully.');
  } catch (error) {
    console.error('[Seed] Seeding error:', error.message);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  seedData();
}

module.exports = seedData;
