const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

const { pool, initDatabase } = require('./config/database');
const { apiLimiter } = require('./middleware/rateLimiter');
const auditLogger = require('./middleware/auditLogger');
const errorHandler = require('./middleware/errorHandler');

// Route imports
const candidateRoutes = require('./routes/candidateRoutes');
const jobRoutes = require('./routes/jobRoutes');
const callRoutes = require('./routes/callRoutes');
const interviewRoutes = require('./routes/interviewRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const reportRoutes = require('./routes/reportRoutes');
const recruiterRoutes = require('./routes/recruiterRoutes');
const simulatorRoutes = require('./routes/simulatorRoutes');
const authRoutes     = require('./routes/authRoutes');
const resumeRoutes   = require('./routes/resumeRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Security & Parsing Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Allows web dashboard inline scripts & styles
}));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('combined'));

// Custom Audit Logging & Rate Limiting
app.use(auditLogger);
app.use('/api/', apiLimiter);

// Serve Static Frontend Dashboard
app.use(express.static(path.join(__dirname, '../public')));

// Health Check Endpoint
app.get('/health', async (req, res) => {
  const { query, getMode } = require('./config/database');
  let dbStatus = 'disconnected';
  try {
    await query('SELECT 1');
    dbStatus = 'connected';
  } catch (err) {
    dbStatus = 'error: ' + err.message;
  }

  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    database: dbStatus,
    databaseMode: require('./config/database').getMode() || 'initializing',
    telephonyProvider: (() => {
      const preferred = (process.env.TELEPHONY_PROVIDER || '').toLowerCase();
      const vapiOk = Boolean(process.env.VAPI_API_KEY && !process.env.VAPI_API_KEY.includes('your_'));
      const exotelOk = Boolean(process.env.EXOTEL_API_KEY && !process.env.EXOTEL_API_KEY.includes('your_'));
      const twilioOk = Boolean(process.env.TWILIO_ACCOUNT_SID && !process.env.TWILIO_ACCOUNT_SID.includes('your_'));
      if (preferred === 'vapi' && vapiOk) return 'vapi';
      if (preferred === 'twilio' && twilioOk) return 'twilio';
      if (preferred === 'exotel' && exotelOk) return 'exotel';
      if (vapiOk) return 'vapi';
      if (twilioOk) return 'twilio';
      return 'browser-simulator-only';
    })(),
    services: {
      vapi: Boolean(process.env.VAPI_API_KEY && !process.env.VAPI_API_KEY.includes('your_')),
      twilio: Boolean(process.env.TWILIO_ACCOUNT_SID && !process.env.TWILIO_ACCOUNT_SID.includes('your_') && process.env.TWILIO_PHONE_NUMBER && !process.env.TWILIO_PHONE_NUMBER.includes('1234567890')),
      exotel: Boolean(process.env.EXOTEL_API_KEY && !process.env.EXOTEL_API_KEY.includes('your_')),
      elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY && !process.env.ELEVENLABS_API_KEY.includes('your_')),
      assemblyai: Boolean(process.env.ASSEMBLYAI_API_KEY && !process.env.ASSEMBLYAI_API_KEY.includes('your_')),
      groq: Boolean(process.env.GROQ_API_KEY && !process.env.GROQ_API_KEY.includes('your_')),
      googleCalendar: Boolean(process.env.GOOGLE_CLIENT_ID && !process.env.GOOGLE_CLIENT_ID.includes('your_')),
    }
  });
});

// Mount Core API Routes
app.use('/api/candidates', candidateRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/interviews', interviewRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/recruiters', recruiterRoutes);
app.use('/api/simulator', simulatorRoutes);
app.use('/api/auth',      authRoutes);
app.use('/api/resumes',   resumeRoutes);
// Direct Google OAuth redirect route matching GOOGLE_REDIRECT_URI in .env
app.get('/auth/google/callback', require('./controllers/authController').googleCallback);

// Fallback to Dashboard for SPA navigation
app.get('*', (req, res, next) => {
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Centralized Error Handling
app.use(errorHandler);

// Start HTTP Server (init database first, then listen)
let server;
initDatabase().then(() => {
  server = app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🤖 AI Recruitment Calling Assistant is running!`);
    console.log(`📡 Server: http://localhost:${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
    console.log(`🗄️  Database: ${require('./config/database').getMode() === 'sqlite' ? 'Local SQLite (Free)' : 'Supabase PostgreSQL'}`);
    console.log(`🧠 NLP: Groq llama-3.3-70b (Free)`);
    console.log(`=======================================================`);
  });
}).catch(err => {
  console.error('[Startup] Fatal database initialization error:', err.message);
  process.exit(1);
});

// Graceful Shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received. Closing HTTP server...');
  server.close(() => {
    pool.end(() => {
      console.log('Database connections closed. Exiting process.');
      process.exit(0);
    });
  });
});

module.exports = app;
