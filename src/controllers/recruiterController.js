const { query } = require('../config/database');

async function getAllRecruiters(req, res, next) {
  try {
    const result = await query('SELECT * FROM recruiters ORDER BY created_at DESC');
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    next(error);
  }
}

async function createRecruiter(req, res, next) {
  try {
    const { full_name, phone_number, email, company_name } = req.body;
    if (!full_name || !email || !company_name) {
      return res.status(400).json({ success: false, error: 'full_name, email, and company_name are required' });
    }

    const result = await query(`
      INSERT INTO recruiters (full_name, phone_number, email, company_name)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [full_name, phone_number || null, email, company_name]);

    res.status(201).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
}

async function updateRecruiter(req, res, next) {
  try {
    const { id } = req.params;
    const { full_name, phone_number, email, company_name } = req.body;

    const existing = await query('SELECT * FROM recruiters WHERE recruiter_id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Recruiter not found' });
    }

    const current = existing.rows[0];
    const result = await query(`
      UPDATE recruiters
      SET full_name = $1, phone_number = $2, email = $3, company_name = $4
      WHERE recruiter_id = $5
      RETURNING *
    `, [
      full_name || current.full_name,
      phone_number || current.phone_number,
      email || current.email,
      company_name || current.company_name,
      id
    ]);

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAllRecruiters,
  createRecruiter,
  updateRecruiter,
};
