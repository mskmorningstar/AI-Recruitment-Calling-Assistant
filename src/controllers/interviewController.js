const { query } = require('../config/database');
const calendarService = require('../services/calendarService');
const { decrypt } = require('../utils/encryption');

/**
 * Check interviewer availability
 * GET /api/interviews/availability?timeMin=...&timeMax=...
 */
async function checkAvailability(req, res, next) {
  try {
    const { timeMin, timeMax, calendarId } = req.query;

    if (calendarService.isConfigured()) {
      const availability = await calendarService.checkAvailability({ timeMin, timeMax, calendarId });
      return res.json({
        success: true,
        data: availability,
      });
    }

    // Fallback if Google credentials not yet loaded in .env
    const now = new Date();
    const suggestedSlots = [
      { start: new Date(now.getTime() + 24 * 3600 * 1000).toISOString(), end: new Date(now.getTime() + 25 * 3600 * 1000).toISOString() },
      { start: new Date(now.getTime() + 48 * 3600 * 1000).toISOString(), end: new Date(now.getTime() + 49 * 3600 * 1000).toISOString() },
    ];

    res.json({
      success: true,
      message: 'Google Calendar credentials not configured in .env. Returning standard business slots.',
      isAvailable: true,
      suggestedSlots,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Core internal scheduling engine
 */
async function coreScheduleInterview({
  candidateId,
  jobId,
  interviewDate,
  interviewTime,
  interviewerEmail,
  recruiterTokens = null,
}) {
  // 1. Validate / Fetch candidate
  const candidateRes = await query('SELECT * FROM candidates WHERE candidate_id = $1', [candidateId]);
  if (candidateRes.rows.length === 0) {
    throw new Error('Candidate not found.');
  }
  const candidate = candidateRes.rows[0];
  const candidateEmail = decrypt(candidate.email);

  // 2. Validate / Fetch job
  let jobTitle = 'Software Engineer';
  let companyName = 'Winit Partner';
  if (jobId) {
    const jobRes = await query('SELECT * FROM jobs WHERE job_id = $1', [jobId]);
    if (jobRes.rows.length > 0) {
      jobTitle = jobRes.rows[0].title;
      companyName = jobRes.rows[0].company_name;
    }
  }

  // 3. Format Date / Time & ISO ranges
  const dateNormalized = interviewDate;
  const timeNormalized = interviewTime.length === 5 ? `${interviewTime}:00` : interviewTime;
  const startDateTime = new Date(`${dateNormalized}T${timeNormalized.slice(0, 5)}:00+05:30`).toISOString();
  const endDateTime = new Date(new Date(startDateTime).getTime() + 45 * 60 * 1000).toISOString();

  // 4. Schedule in Google Calendar
  const calResult = await calendarService.scheduleInterview({
    summary: `Technical Round: ${candidate.full_name} — ${jobTitle}`,
    description: `Candidate: ${candidate.full_name}\nEmail: ${candidateEmail}\nRole: ${jobTitle} (${companyName})\nScheduled by: Winit AI Recruitment Assistant`,
    startDateTime,
    endDateTime,
    candidateEmail,
    interviewerEmail: interviewerEmail || 'recruiter@winit.ai',
    recruiterTokens,
  });

  // 5. Store in interview_schedules
  const result = await query(`
    INSERT INTO interview_schedules (
      candidate_id, job_id, interview_date, interview_time, interviewer_name,
      calendar_event_id, meet_link, calendar_event_url, status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled')
    RETURNING *
  `, [
    candidateId,
    jobId || null,
    dateNormalized,
    timeNormalized,
    interviewerEmail || 'recruiter@winit.ai',
    calResult.eventId,
    calResult.meetLink,
    calResult.htmlLink,
  ]);

  return {
    schedule: result.rows[0],
    calendarResult: calResult,
    candidateName: candidate.full_name,
    candidateEmail,
    jobTitle,
    interviewDate: dateNormalized,
    interviewTime: timeNormalized,
    meetLink: calResult.meetLink,
    calendarUrl: calResult.htmlLink,
  };
}

/**
 * Schedule a new interview (Manual)
 * POST /api/interviews/schedule
 */
async function scheduleInterview(req, res, next) {
  try {
    const { candidateId, jobId, interviewDate, interviewTime, interviewerEmail } = req.body;

    if (!candidateId || !interviewDate || !interviewTime) {
      return res.status(400).json({
        success: false,
        error: 'candidateId, interviewDate, and interviewTime are required.',
      });
    }

    const scheduled = await coreScheduleInterview({
      candidateId,
      jobId,
      interviewDate,
      interviewTime,
      interviewerEmail,
    });

    res.status(201).json({
      success: true,
      message: `Interview scheduled with ${scheduled.candidateName} for ${scheduled.interviewDate} at ${scheduled.interviewTime}!`,
      data: scheduled.schedule,
      meetLink: scheduled.meetLink,
      calendarUrl: scheduled.calendarUrl,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Auto-Schedule an interview using next available business slot
 * POST /api/interviews/auto-schedule
 */
async function autoScheduleInterview(req, res, next) {
  try {
    let { candidateId, jobId, interviewerEmail, preferDaysAhead } = req.body;

    // If no candidate specified, pick the latest
    if (!candidateId) {
      const c = await query('SELECT candidate_id FROM candidates ORDER BY created_at DESC LIMIT 1');
      if (c.rows.length === 0) {
        return res.status(400).json({ success: false, error: 'No candidates available in pipeline to schedule.' });
      }
      candidateId = c.rows[0].candidate_id;
    }

    // If no job specified, pick first active
    if (!jobId) {
      const j = await query('SELECT job_id FROM jobs LIMIT 1');
      if (j.rows.length > 0) jobId = j.rows[0].job_id;
    }

    // Auto-calculate optimal next business day slot
    const slot = calendarService.findNextAvailableSlot(Number(preferDaysAhead) || 1);

    const scheduled = await coreScheduleInterview({
      candidateId,
      jobId,
      interviewDate: slot.date,
      interviewTime: slot.time,
      interviewerEmail,
    });

    res.status(201).json({
      success: true,
      autoScheduled: true,
      message: `⚡ Interview automatically scheduled with ${scheduled.candidateName} on ${scheduled.interviewDate} at ${scheduled.interviewTime} (IST)!`,
      data: scheduled.schedule,
      meetLink: scheduled.meetLink,
      calendarUrl: scheduled.calendarUrl,
      slot,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Quick-book interview (1-Click Booking)
 * POST /api/interviews/quick-book
 */
async function quickBookInterview(req, res, next) {
  return autoScheduleInterview(req, res, next);
}

/**
 * Reusable helper callable from callController / simulator / resume
 */
async function triggerAutoSchedule({ candidateId, jobId, interviewerEmail }) {
  try {
    const slot = calendarService.findNextAvailableSlot(1);
    const scheduled = await coreScheduleInterview({
      candidateId,
      jobId,
      interviewDate: slot.date,
      interviewTime: slot.time,
      interviewerEmail,
    });
    console.log(`[AutoScheduler] Successfully auto-scheduled interview for candidate ${scheduled.candidateName} on ${slot.formatted}`);
    return scheduled;
  } catch (err) {
    console.warn('[AutoScheduler] Auto-scheduling trigger failed:', err.message);
    return null;
  }
}

/**
 * Update interview details
 * PATCH /api/interviews/:id
 */
async function updateInterview(req, res, next) {
  try {
    const { id } = req.params;
    const { interviewDate, interviewTime, status, interviewerName } = req.body;

    const existing = await query('SELECT * FROM interview_schedules WHERE schedule_id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Interview schedule not found.' });
    }

    const current = existing.rows[0];
    const newDate = interviewDate || current.interview_date;
    const newTime = interviewTime || current.interview_time;
    const newStatus = status || current.status;
    const newInterviewer = interviewerName || current.interviewer_name;

    const result = await query(`
      UPDATE interview_schedules
      SET interview_date = $1, interview_time = $2, status = $3, interviewer_name = $4
      WHERE schedule_id = $5
      RETURNING *
    `, [newDate, newTime, newStatus, newInterviewer, id]);

    res.json({
      success: true,
      message: 'Interview schedule updated successfully.',
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Cancel an interview
 * DELETE /api/interviews/:id
 */
async function cancelInterview(req, res, next) {
  try {
    const { id } = req.params;

    const existing = await query('SELECT * FROM interview_schedules WHERE schedule_id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Interview schedule not found.' });
    }

    const schedule = existing.rows[0];

    if (schedule.calendar_event_id) {
      try {
        await calendarService.cancelInterview(schedule.calendar_event_id);
      } catch (calErr) {
        console.warn('[Google Calendar] Could not remove event:', calErr.message);
      }
    }

    await query(`
      UPDATE interview_schedules
      SET status = 'cancelled'
      WHERE schedule_id = $1
    `, [id]);

    res.json({
      success: true,
      message: `Interview schedule ${id} has been marked as cancelled.`,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * List all scheduled interviews
 * GET /api/interviews
 */
async function getAllInterviews(req, res, next) {
  try {
    const result = await query(`
      SELECT s.*, c.full_name, c.phone_number, c.email, j.title as job_title, j.company_name
      FROM interview_schedules s
      LEFT JOIN candidates c ON s.candidate_id = c.candidate_id
      LEFT JOIN jobs j ON s.job_id = j.job_id
      ORDER BY s.created_at DESC
    `);

    const rows = result.rows.map(s => ({
      ...s,
      phone_number: s.phone_number ? decrypt(s.phone_number) : '',
      email: s.email ? decrypt(s.email) : '',
    }));

    res.json({
      success: true,
      count: rows.length,
      data: rows,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  checkAvailability,
  scheduleInterview,
  autoScheduleInterview,
  quickBookInterview,
  triggerAutoSchedule,
  updateInterview,
  cancelInterview,
  getAllInterviews,
};
