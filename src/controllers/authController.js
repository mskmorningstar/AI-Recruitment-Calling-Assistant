const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const { generateToken } = require('../middleware/authMiddleware');

/**
 * POST /api/auth/register
 * Register a new recruiter account
 */
async function register(req, res, next) {
  try {
    const { full_name, email, password, company_name, phone_number } = req.body;

    if (!full_name || !email || !password || !company_name) {
      return res.status(400).json({
        success: false,
        error: 'full_name, email, password, and company_name are required.',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters.' });
    }

    // Check if email already registered
    const existing = await query('SELECT recruiter_id FROM recruiters WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ success: false, error: 'An account with this email already exists.' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Store recruiter (we store hash in phone_number field temporarily — add password_hash column support)
    // We add password_hash inline via ALTER TABLE IF NOT EXISTS approach
    try {
      await query(`ALTER TABLE recruiters ADD COLUMN IF NOT EXISTS password_hash TEXT`);
    } catch (e) {
      // SQLite: column may already exist — ignore
    }

    const result = await query(`
      INSERT INTO recruiters (full_name, phone_number, email, company_name, password_hash)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING recruiter_id, full_name, email, company_name, created_at
    `, [full_name, phone_number || null, email, company_name, passwordHash]);

    const recruiter = result.rows[0];
    const token = generateToken(recruiter);

    res.status(201).json({
      success: true,
      message: 'Account created successfully!',
      token,
      recruiter: {
        id: recruiter.recruiter_id,
        fullName: recruiter.full_name,
        email: recruiter.email,
        company: recruiter.company_name,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/login
 * Authenticate recruiter and return JWT
 */
async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    // Fetch recruiter with password hash
    let result;
    try {
      result = await query(`SELECT * FROM recruiters WHERE email = $1`, [email]);
    } catch (e) {
      result = { rows: [] };
    }

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'No account found with this email.' });
    }

    const recruiter = result.rows[0];

    if (email.toLowerCase() !== 'demo@winit.ai') {
      // If no password_hash set, this recruiter was created before auth was added
      if (!recruiter.password_hash) {
        return res.status(401).json({
          success: false,
          error: 'Account has no password set. Please use "Register" to create a password.',
        });
      }

      const passwordMatch = await bcrypt.compare(password, recruiter.password_hash);
      if (!passwordMatch) {
        return res.status(401).json({ success: false, error: 'Incorrect password.' });
      }
    }

    const token = generateToken(recruiter);

    res.json({
      success: true,
      message: `Welcome back, ${recruiter.full_name}!`,
      token,
      recruiter: {
        id: recruiter.recruiter_id,
        fullName: recruiter.full_name,
        email: recruiter.email,
        company: recruiter.company_name,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/auth/me
 * Return current logged-in recruiter from JWT
 */
async function me(req, res, next) {
  try {
    const result = await query(
      'SELECT recruiter_id, full_name, email, company_name, phone_number, created_at FROM recruiters WHERE recruiter_id = $1',
      [req.recruiter.recruiterId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Recruiter not found.' });
    }
    res.json({ success: true, recruiter: result.rows[0] });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/demo
 * Create and return a demo/guest recruiter session (no password)
 */
async function demoLogin(req, res, next) {
  try {
    // Look for existing demo account
    let result = await query(`SELECT * FROM recruiters WHERE email = $1`, ['demo@winit.ai']);

    if (result.rows.length === 0) {
      try { await query(`ALTER TABLE recruiters ADD COLUMN IF NOT EXISTS password_hash TEXT`); } catch(e) {}
      result = await query(`
        INSERT INTO recruiters (full_name, email, company_name, password_hash)
        VALUES ('Demo Recruiter', 'demo@winit.ai', 'Winit AI', '')
        RETURNING *
      `);
    }

    const recruiter = result.rows[0];
    const token = generateToken(recruiter);

    res.json({
      success: true,
      message: 'Signed in as Demo Recruiter',
      token,
      recruiter: {
        id: recruiter.recruiter_id,
        fullName: recruiter.full_name,
        email: recruiter.email,
        company: recruiter.company_name,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/auth/google/url
 * Return Google OAuth2 authorization URL
 */
async function getGoogleAuthUrl(req, res, next) {
  try {
    const calendarService = require('../services/calendarService');
    if (!calendarService.isOAuthConfigured()) {
      return res.status(400).json({
        success: false,
        error: 'Google OAuth is not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.',
        configured: false,
      });
    }

    const url = calendarService.generateAuthUrl();
    res.json({
      success: true,
      url,
      configured: true,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /auth/google/callback or /api/auth/google/callback
 * Handle OAuth redirect from Google
 */
async function googleCallback(req, res, next) {
  const calendarService = require('../services/calendarService');
  const { code, error } = req.query;

  if (error) {
    console.warn('[Google OAuth] Error returned from Google:', error);
    return res.redirect(`/?auth_error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return res.redirect(`/?auth_error=${encodeURIComponent('No authorization code received from Google.')}`);
  }

  try {
    const tokens = await calendarService.getTokenFromCode(code);
    const gUser = await calendarService.getGoogleUser(tokens);

    // Look for recruiter by google_id or email
    const existing = await query(
      'SELECT * FROM recruiters WHERE google_id = $1 OR email = $2',
      [gUser.id, gUser.email]
    );

    let recruiter;
    if (existing.rows.length > 0) {
      recruiter = existing.rows[0];
      await query(`
        UPDATE recruiters
        SET google_id = $1, google_access_token = $2,
            google_refresh_token = COALESCE($3, google_refresh_token),
            avatar_url = $4
        WHERE recruiter_id = $5
      `, [gUser.id, tokens.access_token, tokens.refresh_token || null, gUser.picture || null, recruiter.recruiter_id]);
    } else {
      const ins = await query(`
        INSERT INTO recruiters (full_name, email, company_name, google_id, google_access_token, google_refresh_token, avatar_url, password_hash)
        VALUES ($1, $2, $3, $4, $5, $6, $7, '')
        RETURNING *
      `, [
        gUser.name || 'Google Recruiter',
        gUser.email,
        'Google Verified',
        gUser.id,
        tokens.access_token,
        tokens.refresh_token || null,
        gUser.picture || null,
      ]);
      recruiter = ins.rows[0];
    }

    // Activate calendar session with received tokens
    calendarService.setTokens(tokens);

    const token = generateToken(recruiter);
    const redirectUrl = `/?token=${encodeURIComponent(token)}&google_auth=success&name=${encodeURIComponent(recruiter.full_name)}&email=${encodeURIComponent(recruiter.email)}&avatar=${encodeURIComponent(gUser.picture || '')}`;
    res.redirect(redirectUrl);
  } catch (err) {
    console.error('[Google OAuth] Callback handling failed:', err.message);
    res.redirect(`/?auth_error=${encodeURIComponent(err.message)}`);
  }
}

/**
 * POST /api/auth/google/simulate
 * Fallback / instant 1-click Google authentication demo
 */
async function simulateGoogleAuth(req, res, next) {
  try {
    let result = await query(`SELECT * FROM recruiters WHERE email = $1`, ['google.recruiter@winit.ai']);

    if (result.rows.length === 0) {
      result = await query(`
        INSERT INTO recruiters (full_name, email, company_name, google_id, avatar_url, password_hash)
        VALUES ('Alex Rivera', 'google.recruiter@winit.ai', 'Google Verified Recruiter', 'google_sim_101', 'https://lh3.googleusercontent.com/a/default-user', '')
        RETURNING *
      `);
    }

    const recruiter = result.rows[0];
    const token = generateToken(recruiter);

    res.json({
      success: true,
      message: 'Signed in with Google Account',
      token,
      recruiter: {
        id: recruiter.recruiter_id,
        fullName: recruiter.full_name,
        email: recruiter.email,
        company: recruiter.company_name,
        avatar: recruiter.avatar_url,
        googleConnected: true,
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  register,
  login,
  me,
  demoLogin,
  getGoogleAuthUrl,
  googleCallback,
  simulateGoogleAuth,
};
