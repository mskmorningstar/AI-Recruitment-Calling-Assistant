const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_recruitment_assistant_2026';

/**
 * Middleware: verify JWT from Authorization header or cookie.
 * For API routes that require a logged-in recruiter.
 */
function requireAuth(req, res, next) {
  let token = null;

  // 1. Check Authorization header
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  }

  // 2. Check x-auth-token header (simple alternative)
  if (!token && req.headers['x-auth-token']) {
    token = req.headers['x-auth-token'];
  }

  if (!token) {
    return res.status(401).json({ success: false, error: 'No auth token. Please log in.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.recruiter = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token. Please log in again.' });
  }
}

/**
 * Generate a JWT for a recruiter
 */
function generateToken(recruiter) {
  return jwt.sign(
    {
      recruiterId: recruiter.recruiter_id,
      email: recruiter.email,
      fullName: recruiter.full_name,
      company: recruiter.company_name,
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

module.exports = { requireAuth, generateToken };
