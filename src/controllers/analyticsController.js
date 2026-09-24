const { query } = require('../config/database');

/**
 * Call statistics and metrics
 * GET /api/analytics/calls
 */
async function getCallAnalytics(req, res, next) {
  try {
    const totalCallsRes = await query('SELECT COUNT(*) AS count FROM call_sessions');
    const statusCountsRes = await query(`
      SELECT call_status, COUNT(*) as count 
      FROM call_sessions 
      GROUP BY call_status
    `);
    const completedCountRes = await query("SELECT COUNT(*) AS count FROM call_sessions WHERE call_status = 'completed'");
    const mode = require('../config/database').getMode();
    const durationSql = mode === 'sqlite'
      ? `SELECT AVG(strftime('%s', call_end_time) - strftime('%s', call_start_time)) as avg_duration_sec
         FROM call_sessions WHERE call_end_time IS NOT NULL AND call_start_time IS NOT NULL`
      : `SELECT AVG(EXTRACT(EPOCH FROM (call_end_time - call_start_time))) as avg_duration_sec
         FROM call_sessions WHERE call_end_time IS NOT NULL AND call_start_time IS NOT NULL`;
    const totalDurationRes = await query(durationSql);

    const total = parseInt(totalCallsRes.rows[0].count, 10);
    const completed = parseInt(completedCountRes.rows[0].count, 10);
    const successRate = total > 0 ? ((completed / total) * 100).toFixed(1) : '0.0';

    const statusBreakdown = {};
    statusCountsRes.rows.forEach(r => {
      statusBreakdown[r.call_status] = parseInt(r.count, 10);
    });

    res.json({
      success: true,
      data: {
        totalCalls: total,
        completedCalls: completed,
        callSuccessRate: `${successRate}%`,
        avgDurationSeconds: Math.round(parseFloat(totalDurationRes.rows[0].avg_duration_sec || 0)),
        statusBreakdown,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Candidate response analytics
 * GET /api/analytics/candidates
 */
async function getCandidateAnalytics(req, res, next) {
  try {
    const totalCandidates = await query('SELECT COUNT(*) AS count FROM candidates');
    const totalInterviews = await query('SELECT COUNT(*) AS count FROM interview_schedules');

    // Aggregate extracted responses by question code
    const questionBreakdown = await query(`
      SELECT question_code, COUNT(*) as answer_count
      FROM candidate_responses
      GROUP BY question_code
      ORDER BY answer_count DESC
    `);

    // Work preferences breakdown
    const preferenceBreakdown = await query(`
      SELECT response_value, COUNT(*) as count
      FROM candidate_responses
      WHERE question_code = 'WORK_PREFERENCES'
      GROUP BY response_value
    `);

    res.json({
      success: true,
      data: {
        totalCandidates: parseInt(totalCandidates.rows[0].count, 10),
        totalInterviewsScheduled: parseInt(totalInterviews.rows[0].count, 10),
        questionBreakdown: questionBreakdown.rows,
        workPreferences: preferenceBreakdown.rows,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Transcript analysis reports
 * GET /api/reports/transcripts
 */
async function getTranscriptReports(req, res, next) {
  try {
    const confidenceStats = await query(`
      SELECT 
        AVG(ai_confidence) as avg_confidence,
        MIN(ai_confidence) as min_confidence,
        MAX(ai_confidence) as max_confidence,
        COUNT(CASE WHEN ai_confidence >= 0.75 THEN 1 END) as high_confidence_count
      FROM call_sessions
      WHERE ai_confidence IS NOT NULL
    `);

    const recentTranscripts = await query(`
      SELECT cs.call_id, cs.call_status, cs.ai_confidence, cs.transcript_text, c.full_name, j.title as job_title
      FROM call_sessions cs
      JOIN candidates c ON cs.candidate_id = c.candidate_id
      LEFT JOIN jobs j ON cs.job_id = j.job_id
      WHERE cs.transcript_text IS NOT NULL
      ORDER BY cs.created_at DESC
      LIMIT 10
    `);

    res.json({
      success: true,
      data: {
        metrics: {
          avgConfidence: parseFloat(confidenceStats.rows[0].avg_confidence || 0).toFixed(2),
          minConfidence: parseFloat(confidenceStats.rows[0].min_confidence || 0).toFixed(2),
          maxConfidence: parseFloat(confidenceStats.rows[0].max_confidence || 0).toFixed(2),
          highConfidenceCount: parseInt(confidenceStats.rows[0].high_confidence_count || 0, 10),
        },
        recentTranscripts: recentTranscripts.rows,
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getCallAnalytics,
  getCandidateAnalytics,
  getTranscriptReports,
};
