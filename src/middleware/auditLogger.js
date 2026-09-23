const { query } = require('../config/database');

/**
 * Middleware that tracks and logs API requests into PostgreSQL
 */
function auditLogger(req, res, next) {
  const startTime = Date.now();

  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const endpoint = req.originalUrl || req.url;
    const method = req.method;
    const statusCode = res.statusCode;

    // Do not audit log static asset fetches or health checks to keep table clean
    if (endpoint.startsWith('/health') || endpoint.startsWith('/favicon') || endpoint.includes('.')) {
      return;
    }

    // Insert asynchronously into api_audit_logs
    query(`
      INSERT INTO api_audit_logs (method, endpoint, status_code, response_time_ms, client_ip, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [method, endpoint, statusCode, responseTime, String(clientIp), String(userAgent)])
    .catch(err => {
      console.warn('[AuditLog] Failed to persist audit record:', err.message);
    });
  });

  next();
}

module.exports = auditLogger;
