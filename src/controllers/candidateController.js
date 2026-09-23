const fs = require('fs');
const csv = require('csv-parser');
const { query } = require('../config/database');
const atsService = require('../services/atsService');
const { encrypt, decrypt } = require('../utils/encryption');

/**
 * Get all candidates
 */
async function getAllCandidates(req, res, next) {
  try {
    const result = await query(`
      SELECT candidate_id, full_name, phone_number, email, source, ats_id, created_at 
      FROM candidates 
      ORDER BY created_at DESC
    `);
    
    // Decrypt PII if encrypted
    const candidates = result.rows.map(c => ({
      ...c,
      phone_number: decrypt(c.phone_number),
      email: decrypt(c.email),
    }));

    res.json({
      success: true,
      count: candidates.length,
      data: candidates,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get candidate by ID with recent call sessions
 */
async function getCandidateById(req, res, next) {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT * FROM candidates WHERE candidate_id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Candidate not found' });
    }

    const candidate = result.rows[0];
    candidate.phone_number = decrypt(candidate.phone_number);
    candidate.email = decrypt(candidate.email);

    // Fetch call history
    const callSessions = await query(
      `SELECT * FROM call_sessions WHERE candidate_id = $1 ORDER BY created_at DESC`,
      [id]
    );

    // Fetch interview schedules
    const interviews = await query(
      `SELECT * FROM interview_schedules WHERE candidate_id = $1 ORDER BY created_at DESC`,
      [id]
    );

    res.json({
      success: true,
      data: {
        ...candidate,
        callSessions: callSessions.rows,
        interviews: interviews.rows,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Upload candidates via CSV file
 */
async function uploadCandidatesCsv(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Please upload a CSV file with candidates data.' });
    }

    const results = [];
    fs.createReadStream(req.file.path)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', async () => {
        try {
          // Remove temp file
          fs.unlinkSync(req.file.path);

          const insertedCandidates = [];
          for (const row of results) {
            // Flexible column header mapping
            const fullName = row.full_name || row.fullName || row.name || row.Name || 'Unknown';
            const phone = row.phone_number || row.phone || row.Phone || '';
            const email = row.email || row.Email || '';
            const source = row.source || 'CSV_Upload';
            const atsId = row.ats_id || row.atsId || null;

            if (fullName && (phone || email)) {
              const insertResult = await query(`
                INSERT INTO candidates (full_name, phone_number, email, source, ats_id)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING candidate_id, full_name, phone_number, email, source, ats_id, created_at
              `, [fullName, phone, email, source, atsId]);
              insertedCandidates.push(insertResult.rows[0]);
            }
          }

          res.status(201).json({
            success: true,
            message: `Successfully processed CSV and imported ${insertedCandidates.length} candidates.`,
            count: insertedCandidates.length,
            data: insertedCandidates,
          });
        } catch (dbErr) {
          next(dbErr);
        }
      });
  } catch (error) {
    next(error);
  }
}

/**
 * Update candidate information
 */
async function updateCandidate(req, res, next) {
  try {
    const { id } = req.params;
    const { full_name, phone_number, email, source, ats_id } = req.body;

    const existing = await query(`SELECT * FROM candidates WHERE candidate_id = $1`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Candidate not found' });
    }

    const current = existing.rows[0];
    const updatedName = full_name || current.full_name;
    const updatedPhone = phone_number || current.phone_number;
    const updatedEmail = email || current.email;
    const updatedSource = source || current.source;
    const updatedAtsId = ats_id || current.ats_id;

    const result = await query(`
      UPDATE candidates 
      SET full_name = $1, phone_number = $2, email = $3, source = $4, ats_id = $5
      WHERE candidate_id = $6
      RETURNING *
    `, [updatedName, updatedPhone, updatedEmail, updatedSource, updatedAtsId, id]);

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Delete candidate (GDPR Compliance: complete removal or anonymization)
 */
async function deleteCandidate(req, res, next) {
  try {
    const { id } = req.params;

    const check = await query(`SELECT * FROM candidates WHERE candidate_id = $1`, [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Candidate not found' });
    }

    // Cascade delete candidate and associated data
    await query(`DELETE FROM candidates WHERE candidate_id = $1`, [id]);

    res.json({
      success: true,
      message: `Candidate ${id} and all related call sessions and personal data were deleted permanently in compliance with GDPR.`,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAllCandidates,
  getCandidateById,
  uploadCandidatesCsv,
  updateCandidate,
  deleteCandidate,
};
