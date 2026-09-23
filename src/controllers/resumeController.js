const { query } = require('../config/database');
const { PDFParse } = require('pdf-parse');
const multer = require('multer');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Multer setup — accept PDF and CSV
const upload = multer({
  dest: path.join(os.tmpdir(), 'resume_uploads'),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.doc', '.docx', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only PDF, DOC, DOCX, TXT files allowed'));
  },
});

/**
 * Extract text from a PDF file buffer
 */
async function extractPdfText(filePath) {
  const buf = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: buf });
  const result = await parser.getText();
  return (result.text || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Use Groq AI to parse resume text into structured candidate profile
 */
async function parseResumeWithAI(resumeText) {
  const fetch = require('node-fetch');
  const groqKey = process.env.GROQ_API_KEY;

  if (!groqKey) {
    // Fallback basic extraction using regex
    return basicExtraction(resumeText);
  }

  const prompt = `You are a professional HR assistant. Extract structured information from the following resume text.

Return ONLY a valid JSON object (no markdown, no explanation) with these fields:
{
  "full_name": "string — candidate's full name",
  "email": "string — email address or null",
  "phone_number": "string — phone number with country code, or null",
  "current_title": "string — current or most recent job title",
  "years_experience": "number — total years of professional experience",
  "current_company": "string — current or most recent company name or null",
  "skills": ["array", "of", "technical", "skills"],
  "education": "string — highest degree and institution",
  "location": "string — city or country if mentioned, or null",
  "summary": "string — 2-sentence professional summary",
  "notice_period": "string — notice period if mentioned, else null",
  "current_salary": "string — current salary if mentioned, else null",
  "expected_salary": "string — expected salary if mentioned, else null"
}

Resume text:
${resumeText.slice(0, 4000)}`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 1000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) throw new Error(`Groq error ${response.status}`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{}';
    return JSON.parse(content);
  } catch (e) {
    console.warn('[ResumeParser] AI extraction failed, using basic:', e.message);
    return basicExtraction(resumeText);
  }
}

/**
 * Basic regex-based extraction as fallback
 */
function basicExtraction(text) {
  const emailMatch = text.match(/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/);
  const phoneMatch = text.match(/(?:\+91[\s\-]?)?\b[6-9]\d{9}\b|\+?1?\s*\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{4}/);
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);

  return {
    full_name: lines[0] || 'Unknown Candidate',
    email: emailMatch ? emailMatch[0] : null,
    phone_number: phoneMatch ? phoneMatch[0] : null,
    current_title: null,
    years_experience: null,
    current_company: null,
    skills: [],
    education: null,
    location: null,
    summary: text.slice(0, 200),
    notice_period: null,
    current_salary: null,
    expected_salary: null,
  };
}

/**
 * POST /api/resumes/parse
 * Upload a resume PDF and extract candidate profile using AI
 */
async function parseResume(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded. Please attach a PDF resume.' });
    }

    const filePath = req.file.path;
    const originalName = req.file.originalname;
    const ext = path.extname(originalName).toLowerCase();

    let resumeText = '';

    if (ext === '.pdf') {
      try {
        resumeText = await extractPdfText(filePath);
      } catch (pdfErr) {
        fs.unlinkSync(filePath);
        return res.status(422).json({ success: false, error: 'Could not read PDF: ' + pdfErr.message });
      }
    } else if (ext === '.txt') {
      resumeText = fs.readFileSync(filePath, 'utf8');
    } else {
      fs.unlinkSync(filePath);
      return res.status(422).json({ success: false, error: 'For DOC/DOCX files, please save as PDF first.' });
    }

    // Clean up temp file
    try { fs.unlinkSync(filePath); } catch (e) {}

    if (!resumeText || resumeText.length < 50) {
      return res.status(422).json({
        success: false,
        error: 'Could not extract text from file. Please ensure it is a text-based PDF (not a scanned image).',
      });
    }

    const profile = await parseResumeWithAI(resumeText);

    res.json({
      success: true,
      profile,
      rawText: resumeText.slice(0, 2000), // First 2000 chars for display
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/resumes/add-candidate
 * Save AI-extracted resume profile as a candidate in the DB
 */
async function addCandidateFromResume(req, res, next) {
  try {
    const {
      full_name, email, phone_number, current_title, years_experience,
      skills, location, summary, notice_period, current_salary, expected_salary,
      job_id,
    } = req.body;

    if (!full_name) {
      return res.status(400).json({ success: false, error: 'full_name is required.' });
    }

    const { encrypt } = require('../utils/encryption');

    const safeEmail = email || `${full_name.toLowerCase().replace(/[^a-z0-9]/g, '')}_${Date.now()}@resume.local`;
    const safePhone = phone_number || `resume-${Date.now()}`;

    // Check for duplicate by email
    const existing = await query('SELECT candidate_id FROM candidates WHERE email = $1', [encrypt(safeEmail)]);

    let candidateId;
    if (existing.rows.length > 0) {
      candidateId = existing.rows[0].candidate_id;
    } else {
      const ins = await query(`
        INSERT INTO candidates (full_name, phone_number, email, source, ats_id)
        VALUES ($1, $2, $3, 'Resume Upload', $4)
        RETURNING candidate_id
      `, [
        full_name,
        encrypt(safePhone),
        encrypt(safeEmail),
        `RESUME-${Date.now()}`,
      ]);
      candidateId = ins.rows[0].candidate_id;
    }

    // Store structured screening data as a candidate_response for later use
    if (skills || current_title || years_experience) {
      // Store as a synthetic call session note
      const sessionRes = await query(`
        INSERT INTO call_sessions (candidate_id, job_id, call_status, transcript_text, ai_confidence)
        VALUES ($1, $2, 'resume_parsed', $3, $4)
        RETURNING call_id
      `, [
        candidateId,
        job_id || null,
        `Resume Profile: ${current_title || ''}\nExperience: ${years_experience || ''}yrs\nSkills: ${Array.isArray(skills) ? skills.join(', ') : skills || ''}\nLocation: ${location || ''}\nSummary: ${summary || ''}\nNotice: ${notice_period || 'N/A'}\nCurrent: ${current_salary || 'N/A'}\nExpected: ${expected_salary || 'N/A'}`,
        95.0,
      ]);

      const callId = sessionRes.rows[0].call_id;

      // Store responses
      const responses = [
        ['CURRENT_TITLE', current_title],
        ['YEARS_EXPERIENCE', String(years_experience || '')],
        ['SKILLS', Array.isArray(skills) ? skills.join(', ') : skills || ''],
        ['LOCATION', location],
        ['NOTICE_PERIOD', notice_period],
        ['CURRENT_SALARY', current_salary],
        ['EXPECTED_SALARY', expected_salary],
      ];

      for (const [code, val] of responses) {
        if (val) {
          await query(`
            INSERT INTO candidate_responses (call_id, question_code, response_text, response_value)
            VALUES ($1, $2, $3, $4)
          `, [callId, code, val, val]);
        }
      }
    }

    res.status(201).json({
      success: true,
      message: `${full_name} added to candidates successfully!`,
      candidateId,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  upload,
  parseResume,
  addCandidateFromResume,
};
