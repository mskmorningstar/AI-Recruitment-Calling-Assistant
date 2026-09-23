const { query } = require('../config/database');
const twilioService = require('../services/twilioService');
const exotelService = require('../services/exotelService');
const vapiService   = require('../services/vapiService');
const elevenLabsService = require('../services/elevenLabsService');
const assemblyAiService = require('../services/assemblyAiService');
const nlpService = require('../services/nlpService');
const { decrypt } = require('../utils/encryption');


/**
 * Detect which telephony provider is active
 * Priority: TELEPHONY_PROVIDER env → vapi → exotel → twilio
 */
function getActiveProvider() {
  const preferred = (process.env.TELEPHONY_PROVIDER || '').toLowerCase();
  if (preferred === 'vapi' && vapiService.isConfigured()) {
    return { name: 'vapi', service: vapiService };
  }
  if (preferred === 'exotel' && exotelService.isConfigured()) {
    return { name: 'exotel', service: exotelService };
  }
  if (preferred === 'twilio' && twilioService.isConfigured()) {
    return { name: 'twilio', service: twilioService };
  }
  // Auto-detect in priority order: only use providers that are valid and not disabled
  if (preferred && preferred !== 'none') {
    if (preferred === 'vapi' && vapiService.isConfigured()) return { name: 'vapi', service: vapiService };
    if (preferred === 'twilio' && twilioService.isConfigured()) return { name: 'twilio', service: twilioService };
    if (preferred === 'exotel' && exotelService.isConfigured()) return { name: 'exotel', service: exotelService };
  }
  // Fallback order: twilio -> vapi -> exotel
  if (twilioService.isConfigured()) return { name: 'twilio', service: twilioService };
  if (vapiService.isConfigured())   return { name: 'vapi',   service: vapiService };
  return null;
}

/**
 * Initiate an outbound call to candidate
 * POST /api/calls/initiate
 * Body: { candidateId, jobId }
 */
async function initiateCall(req, res, next) {
  try {
    const { candidateId, jobId } = req.body;

    if (!candidateId) {
      return res.status(400).json({ success: false, error: 'candidateId is required' });
    }

    // 1. Fetch candidate
    const candidateRes = await query('SELECT * FROM candidates WHERE candidate_id = $1', [candidateId]);
    if (candidateRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Candidate not found' });
    }
    const candidate = candidateRes.rows[0];
    const candidatePhone = decrypt(candidate.phone_number);

    // 2. Fetch Job details if provided
    let job = null;
    if (jobId) {
      const jobRes = await query('SELECT * FROM jobs WHERE job_id = $1', [jobId]);
      if (jobRes.rows.length > 0) job = jobRes.rows[0];
    }

    // 3. Create call_session record
    const sessionRes = await query(`
      INSERT INTO call_sessions (candidate_id, job_id, call_start_time, call_status)
      VALUES ($1, $2, CURRENT_TIMESTAMP, 'initiated')
      RETURNING *
    `, [candidateId, jobId || null]);

    const callSession = sessionRes.rows[0];
    const callId = callSession.call_id;

    // 4. Auto-detect telephony provider and initiate call
    const provider = getActiveProvider();
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    let callInfo = null;

    if (provider) {
      try {
        callInfo = await provider.service.initiateCall({
          candidatePhone,
          candidateName: candidate.full_name,
          jobTitle: job?.title || 'Open Position',
          callId,
          callbackBaseUrl: process.env.PUBLIC_URL || baseUrl,
        });

        await query(
          'UPDATE call_sessions SET twilio_call_sid = $1, call_status = $2 WHERE call_id = $3',
          [callInfo.callSid, 'ringing', callId]
        );

        console.log(`[${provider.name.toUpperCase()}] Call initiated → SID: ${callInfo.callSid}`);
      } catch (providerErr) {
        console.warn(`[${provider.name.toUpperCase()}] Telecom dial notice:`, providerErr.message);
        await query("UPDATE call_sessions SET call_status = 'simulator_ready' WHERE call_id = $1", [callId]);
        callInfo = {
          status: 'telecom_trial_pending',
          provider: provider.name,
          notice: providerErr.message,
          mode: 'simulator_ready'
        };
      }
    } else {
      console.warn('[Telephony] No provider configured — session created in simulator/demo mode.');
    }

    res.status(201).json({
      success: true,
      message: 'Outbound recruitment call initiated successfully.',
      callId,
      provider: provider?.name || 'simulator',
      session: callSession,
      call: callInfo || { status: 'session_created_no_telephony_provider' },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Directly call any phone number entered in the dashboard input field
 * POST /api/calls/direct-call
 * Body: { fullName, phoneNumber, email, jobId }
 */
async function directCall(req, res, next) {
  try {
    const { fullName, phoneNumber, email, jobId } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ success: false, error: 'Phone number is required.' });
    }

    const name = (fullName || 'Client Contact').trim();
    const cleanPhone = phoneNumber.trim();
    const cleanEmail = (email || `${name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'client'}@recruitment.com`).trim();

    // Look for existing candidate by decrypted phone/email
    const allCands = await query('SELECT candidate_id, phone_number, email FROM candidates');
    let candidateId = null;

    for (const row of allCands.rows) {
      if (decrypt(row.phone_number) === cleanPhone || decrypt(row.email) === cleanEmail) {
        candidateId = row.candidate_id;
        break;
      }
    }

    if (!candidateId) {
      const { encrypt } = require('../utils/encryption');
      const ins = await query(`
        INSERT INTO candidates (full_name, phone_number, email, source)
        VALUES ($1, $2, $3, 'Direct Dial')
        RETURNING candidate_id
      `, [name, encrypt(cleanPhone), encrypt(cleanEmail)]);
      candidateId = ins.rows[0].candidate_id;
    }

    // Forward to initiateCall logic
    req.body.candidateId = candidateId;
    return initiateCall(req, res, next);
  } catch (err) {
    next(err);
  }
}

/**
 * Get call session status
 * GET /api/calls/:id/status
 */
async function getCallStatus(req, res, next) {
  try {
    const { id } = req.params;
    const sessionRes = await query(`
      SELECT cs.*, c.full_name, c.phone_number, c.email, j.title as job_title, j.company_name
      FROM call_sessions cs
      JOIN candidates c ON cs.candidate_id = c.candidate_id
      LEFT JOIN jobs j ON cs.job_id = j.job_id
      WHERE cs.call_id = $1
    `, [id]);

    if (sessionRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Call session not found' });
    }

    const session = sessionRes.rows[0];

    // Refresh live status from whichever provider is active
    if (session.twilio_call_sid && ['initiated', 'ringing'].includes(session.call_status)) {
      try {
        let liveStatus = null;
        if (twilioService.isConfigured()) {
          liveStatus = await twilioService.getCallStatus(session.twilio_call_sid);
        } else if (exotelService.isConfigured()) {
          liveStatus = await exotelService.getCallStatus(session.twilio_call_sid);
        }
        if (liveStatus && liveStatus.status !== session.call_status) {
          await query('UPDATE call_sessions SET call_status = $1 WHERE call_id = $2', [liveStatus.status, id]);
          session.call_status = liveStatus.status;
        }
      } catch (err) {
        console.warn('[Status] Could not fetch live call status:', err.message);
      }
    }

    res.json({
      success: true,
      data: session,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Handle Twilio Webhooks (Call status updates & recordings)
 * POST /api/calls/webhook
 */
async function handleTwilioWebhook(req, res, next) {
  try {
    const { CallSid, CallStatus, CallDuration, RecordingUrl } = req.body;
    console.log(`[Twilio Webhook] CallSid: ${CallSid}, Status: ${CallStatus}, Duration: ${CallDuration}s`);

    const updateFields = [];
    const values = [];
    let idx = 1;

    if (CallStatus) {
      updateFields.push(`call_status = $${idx++}`);
      values.push(CallStatus);
    }

    if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'busy' || CallStatus === 'no-answer') {
      updateFields.push(`call_end_time = CURRENT_TIMESTAMP`);
    }

    if (RecordingUrl) {
      updateFields.push(`recording_url = $${idx++}`);
      values.push(RecordingUrl);
    }

    if (updateFields.length > 0 && CallSid) {
      values.push(CallSid);
      await query(`
        UPDATE call_sessions 
        SET ${updateFields.join(', ')} 
        WHERE twilio_call_sid = $${idx}
      `, values);
    }

    // Acknowledge Twilio
    res.type('text/xml').send('<Response></Response>');
  } catch (error) {
    next(error);
  }
}

/**
 * Handle Exotel Webhooks (Call status updates from Exotel passthru URL)
 * POST /api/calls/webhook-exotel
 * Exotel sends: CallSid, Status, Duration, RecordingUrl
 */
async function handleExotelWebhook(req, res, next) {
  try {
    // Exotel uses different field names than Twilio
    const callSid    = req.body.CallSid || req.body.call_sid;
    const callStatus = req.body.Status  || req.body.status;
    const duration   = req.body.Duration || req.body.duration;
    const recordingUrl = req.body.RecordingUrl || req.body.recording_url;

    console.log(`[Exotel Webhook] SID: ${callSid}, Status: ${callStatus}, Duration: ${duration}s`);

    const updateFields = [];
    const values = [];
    let idx = 1;

    // Map Exotel statuses → our internal statuses
    const statusMap = {
      'in-progress': 'in-progress',
      'completed':   'completed',
      'failed':      'failed',
      'busy':        'busy',
      'no-answer':   'no-answer',
      'canceled':    'cancelled',
      'ringing':     'ringing',
    };
    const mappedStatus = statusMap[callStatus] || callStatus;

    if (mappedStatus) {
      updateFields.push(`call_status = $${idx++}`);
      values.push(mappedStatus);
    }

    if (['completed', 'failed', 'busy', 'no-answer', 'cancelled'].includes(mappedStatus)) {
      updateFields.push(`call_end_time = CURRENT_TIMESTAMP`);
    }

    if (recordingUrl) {
      updateFields.push(`recording_url = $${idx++}`);
      values.push(recordingUrl);
    }

    if (updateFields.length > 0 && callSid) {
      values.push(callSid);
      await query(
        `UPDATE call_sessions SET ${updateFields.join(', ')} WHERE twilio_call_sid = $${idx}`,
        values
      );
    }

    // Trigger NLP if call completed and has recording
    if (mappedStatus === 'completed' && recordingUrl) {
      const sessRes = await query('SELECT call_id FROM call_sessions WHERE twilio_call_sid = $1', [callSid]);
      if (sessRes.rows.length > 0) {
        const callId = sessRes.rows[0].call_id;
        processNlpForCallInternal(callId).catch(err => {
          console.warn('[Background NLP] Exotel post-call NLP error:', err.message);
        });
      }
    }

    // Exotel expects HTTP 200 with empty body
    res.status(200).send('OK');
  } catch (error) {
    next(error);
  }
}

/**
 * Dynamic TwiML generator (Twilio) — called when call is answered
 * POST /api/calls/twiml
 */
async function generateCallTwiML(req, res, next) {
  try {
    const { callId, step = '0' } = req.query;
    const info = await getCallInfo(callId);
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const audioBaseUrl = process.env.PUBLIC_URL || baseUrl;
    const actionUrl = `/api/calls/gather?callId=${callId || ''}&step=${step}`;
    const twiml = twilioService.generateScreeningTwiML({
      candidateName: info.candidateName,
      companyName:   info.companyName,
      jobTitle:      info.jobTitle,
      actionUrl,
      step: String(step),
      audioBaseUrl,
    });
    res.type('text/xml').send(twiml);
  } catch (error) {
    next(error);
  }
}

/**
 * Exotel passthru XML — served when Exotel connects candidate
 * GET|POST /api/calls/twiml-exotel?callId=xxx&step=0
 * Exotel fetches this URL and follows XML instructions
 */
async function generateExotelXml(req, res, next) {
  try {
    const { callId, step = '0' } = req.query;
    const info = await getCallInfo(callId);
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const audioBaseUrl = process.env.PUBLIC_URL || baseUrl;
    const actionUrl = `${baseUrl}/api/calls/gather-exotel?callId=${callId || ''}&step=${step}`;

    const xml = exotelService.generateScreeningXml({
      candidateName: info.candidateName,
      jobTitle:      info.jobTitle,
      companyName:   info.companyName,
      actionUrl,
      step: String(step),
      audioBaseUrl,
    });

    console.log(`[Exotel XML] CallId: ${callId} Step: ${step} → serving XML`);
    // Mark call as in-progress when candidate picks up (step 0)
    if (step === '0' && callId) {
      await query("UPDATE call_sessions SET call_status = 'in-progress', call_start_time = CURRENT_TIMESTAMP WHERE call_id = $1", [callId]).catch(() => {});
    }

    res.type('text/xml').send(xml);
  } catch (error) {
    next(error);
  }
}

/**
 * Exotel speech gather handler — called after candidate speaks
 * POST /api/calls/gather-exotel?callId=xxx&step=N
 * Exotel posts SpeechResult here, we return next XML instruction
 */
async function handleExotelGather(req, res, next) {
  try {
    const speechRaw = req.body.SpeechResult || req.body.speech_result || '';
    const digitsRaw = req.body.Digits || req.body.digits || '';
    const speechResult = speechRaw || (digitsRaw === '1' ? 'Yes (Confirmed)' : (digitsRaw === '2' ? 'No (Declined)' : (digitsRaw ? `Option ${digitsRaw}` : '')));

    const { callId, step = '0' } = req.query;
    const currentStep = parseInt(step, 10);
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const audioBaseUrl = process.env.PUBLIC_URL || baseUrl;

    console.log(`[Exotel Gather] Call:${callId} Step:${step} → "${speechResult}"`);

    // Append to transcript
    if (callId && speechResult) {
      const questionLabels = [
        'Interest Confirmation',
        'Compensation Expectations',
        'Notice Period & Work Preference',
        'Skills & Experience',
      ];
      const label = questionLabels[currentStep] || `Step ${step}`;
      await query(`
        UPDATE call_sessions
        SET transcript_text = COALESCE(transcript_text, '') || $1
        WHERE call_id = $2
      `, [`\nCandidate [${label}]: ${speechResult}`, callId]).catch(() => {});
    }

    // Check if candidate said "no" at step 0
    if (currentStep === 0) {
      const lower = speechResult.toLowerCase();
      const notInterested = lower.includes('no') || lower.includes('not') || lower.includes('busy') || lower.includes('later') || digitsRaw === '2';
      if (notInterested) {
        await query("UPDATE call_sessions SET call_status = 'completed' WHERE call_id = $1", [callId]).catch(() => {});
        const closingXml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="female" language="en-IN">No problem at all! I understand you are occupied. Have a great day. Goodbye!</Say>
  <Hangup/>
</Response>`;
        return res.type('text/xml').send(closingXml);
      }
    }

    const nextStep = currentStep + 1;
    const info = await getCallInfo(callId);

    // After step 3 (last question), wrap up and trigger NLP
    if (nextStep > 3) {
      const closingXml = exotelService.generateScreeningXml({
        candidateName: info.candidateName,
        jobTitle:      info.jobTitle,
        companyName:   info.companyName,
        actionUrl:     '',
        step:          'done',
        audioBaseUrl,
      });

      // Mark call completed and trigger background NLP
      if (callId) {
        await query("UPDATE call_sessions SET call_status = 'completed', call_end_time = CURRENT_TIMESTAMP WHERE call_id = $1", [callId]).catch(() => {});
        processNlpForCallInternal(callId).catch(err => {
          console.warn('[Background NLP] Error:', err.message);
        });
      }

      return res.type('text/xml').send(closingXml);
    }

    // Serve next question
    const nextActionUrl = `${baseUrl}/api/calls/gather-exotel?callId=${callId || ''}&step=${nextStep}`;
    const nextXml = exotelService.generateScreeningXml({
      candidateName: info.candidateName,
      jobTitle:      info.jobTitle,
      companyName:   info.companyName,
      actionUrl:     nextActionUrl,
      step:          String(nextStep),
      audioBaseUrl,
    });

    res.type('text/xml').send(nextXml);
  } catch (error) {
    next(error);
  }
}

/**
 * Helper: fetch candidate + job info for a call session
 */
async function getCallInfo(callId) {
  let candidateName = 'there', companyName = 'our company', jobTitle = 'the open role';
  if (callId) {
    try {
      const info = await query(`
        SELECT c.full_name, j.title, j.company_name
        FROM call_sessions cs
        JOIN candidates c ON cs.candidate_id = c.candidate_id
        LEFT JOIN jobs j ON cs.job_id = j.job_id
        WHERE cs.call_id = $1
      `, [callId]);
      if (info.rows.length > 0) {
        candidateName = info.rows[0].full_name || candidateName;
        companyName   = info.rows[0].company_name || companyName;
        jobTitle      = info.rows[0].title || jobTitle;
      }
    } catch {}
  }
  return { candidateName, companyName, jobTitle };
}


/**
 * Handle interactive candidate speech responses during call
 * POST /api/calls/gather
 */
async function handleSpeechGather(req, res, next) {
  try {
    const { SpeechResult } = req.body;
    const { callId, step = '1' } = req.query;

    console.log(`[Twilio Gather] Call ${callId} Step ${step} Candidate Speech: "${SpeechResult}"`);

    // Append speech to transcript_text in call_sessions
    if (callId && SpeechResult) {
      await query(`
        UPDATE call_sessions 
        SET transcript_text = COALESCE(transcript_text, '') || E'\nCandidate: ' || $1
        WHERE call_id = $2
      `, [SpeechResult, callId]);
    }

    const twilio = require('twilio');
    const response = new twilio.twiml.VoiceResponse();

    // Step machine for screening questions
    if (step === '1') {
      // Step 1: Candidate confirmed interest -> Ask about current & expected salary
      const gather = response.gather({
        input: 'speech',
        action: `/api/calls/gather?callId=${callId}&step=2`,
        method: 'POST',
        timeout: 4,
      });
      gather.say({ voice: 'Polly.Joanna-Neural' },
        "Great! To make sure this aligns with your expectations, could you share your current salary and what expected compensation range you are looking for?"
      );
    } else if (step === '2') {
      // Step 2: Salary captured -> Ask about Notice Period & Location preference
      const gather = response.gather({
        input: 'speech',
        action: `/api/calls/gather?callId=${callId}&step=3`,
        method: 'POST',
        timeout: 4,
      });
      gather.say({ voice: 'Polly.Joanna-Neural' },
        "Thank you. And what is your current notice period or earliest availability, and do you prefer remote, hybrid, or onsite?"
      );
    } else if (step === '3') {
      // Step 3: Notice captured -> Wrap up and notify candidate regarding interview scheduling
      response.say({ voice: 'Polly.Joanna-Neural' },
        "Thank you for sharing those details. You sound like a fantastic match for the team! Our hiring manager will review your notes and email you an interview calendar invitation shortly. Have a wonderful day!"
      );
      response.hangup();

      // Trigger background NLP parsing
      if (callId) {
        processNlpForCallInternal(callId).catch(err => {
          console.warn('[Background NLP] Error parsing transcript:', err.message);
        });
      }
    } else {
      response.say({ voice: 'Polly.Joanna-Neural' }, "Thank you for speaking with us. Goodbye!");
      response.hangup();
    }

    res.type('text/xml').send(response.toString());
  } catch (error) {
    next(error);
  }
}

/**
 * Get call recording URL
 * GET /api/calls/:id/recording
 */
async function getCallRecording(req, res, next) {
  try {
    const { id } = req.params;
    const sessionRes = await query('SELECT recording_url, twilio_call_sid FROM call_sessions WHERE call_id = $1', [id]);

    if (sessionRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Call session not found' });
    }

    const session = sessionRes.rows[0];

    // If recording_url is already populated
    if (session.recording_url) {
      return res.json({
        success: true,
        recordingUrl: session.recording_url,
      });
    }

    // Try fetching from whichever provider is active
    if (session.twilio_call_sid) {
      let recordings = [];
      if (twilioService.isConfigured()) {
        recordings = await twilioService.getCallRecordings(session.twilio_call_sid);
      } else if (exotelService.isConfigured()) {
        recordings = await exotelService.getRecordings(session.twilio_call_sid);
      }
      if (recordings.length > 0) {
        const latestUrl = recordings[0].url;
        await query('UPDATE call_sessions SET recording_url = $1 WHERE call_id = $2', [latestUrl, id]);
        return res.json({
          success: true,
          recordingUrl: latestUrl,
          recordings,
        });
      }
    }

    res.json({
      success: true,
      recordingUrl: null,
      message: 'Recording not yet available or call was not recorded.',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get call transcript and structured responses
 * GET /api/calls/:id/transcript
 */
async function getCallTranscript(req, res, next) {
  try {
    const { id } = req.params;
    const sessionRes = await query('SELECT call_id, transcript_text, ai_confidence, call_status FROM call_sessions WHERE call_id = $1', [id]);

    if (sessionRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Call session not found' });
    }

    const session = sessionRes.rows[0];
    const responsesRes = await query('SELECT question_code, response_text, response_value FROM candidate_responses WHERE call_id = $1', [id]);

    res.json({
      success: true,
      callId: id,
      transcript: session.transcript_text,
      confidence: session.ai_confidence,
      status: session.call_status,
      structuredResponses: responsesRes.rows,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Internal helper to run NLP extraction and populate candidate_responses table
 */
async function processNlpForCallInternal(callId) {
  const sessionRes = await query(`
    SELECT cs.candidate_id, cs.job_id, cs.transcript_text, j.jd_text, j.title, cs.recording_url
    FROM call_sessions cs
    LEFT JOIN jobs j ON cs.job_id = j.job_id
    WHERE cs.call_id = $1
  `, [callId]);

  if (sessionRes.rows.length === 0) return;
  const { transcript_text, jd_text, recording_url } = sessionRes.rows[0];

  let textToParse = transcript_text;

  // If transcript is empty but recording exists, transcribe with AssemblyAI
  if (!textToParse && recording_url && assemblyAiService.isConfigured()) {
    try {
      const transcription = await assemblyAiService.transcribeAudio(recording_url);
      textToParse = transcription.text;
      await query('UPDATE call_sessions SET transcript_text = $1 WHERE call_id = $2', [textToParse, callId]);
    } catch (sttErr) {
      console.warn('[STT] AssemblyAI transcription error:', sttErr.message);
    }
  }

  if (!textToParse) return;

  if (nlpService.isConfigured()) {
    const parsed = await nlpService.extractResponses({
      transcriptText: textToParse,
      jobDescription: jd_text,
    });

    if (parsed.confidenceScore) {
      await query('UPDATE call_sessions SET ai_confidence = $1 WHERE call_id = $2', [parsed.confidenceScore, callId]);
    }

    if (Array.isArray(parsed.responses)) {
      for (const item of parsed.responses) {
        await query(`
          INSERT INTO candidate_responses (call_id, question_code, response_text, response_value)
          VALUES ($1, $2, $3, $4)
        `, [callId, item.questionCode, item.rawText, item.normalizedValue]);
      }
    }

    // Auto-schedule interview in Google Calendar if candidate passed screening (confidence >= 60)
    const candId = sessionRes.rows[0].candidate_id;
    const jId = sessionRes.rows[0].job_id;
    if (candId && (parsed.confidenceScore >= 60 || !parsed.confidenceScore)) {
      try {
        const { triggerAutoSchedule } = require('./interviewController');
        await triggerAutoSchedule({ candidateId: candId, jobId: jId });
        console.log(`[AutoScheduler] Auto-booked interview for candidate ${candId} after screening evaluation.`);
      } catch (autoErr) {
        console.warn('[AutoScheduler] Auto-scheduling trigger notice:', autoErr.message);
      }
    }
  }
}

/**
 * Run NLP Processing manually on a call session
 * POST /api/calls/:id/process-nlp
 */
async function processNlpForCall(req, res, next) {
  try {
    const { id } = req.params;
    await processNlpForCallInternal(id);
    const updated = await query('SELECT question_code, response_text, response_value FROM candidate_responses WHERE call_id = $1', [id]);

    res.json({
      success: true,
      message: 'NLP processing completed successfully.',
      callId: id,
      responses: updated.rows,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * List all call sessions
 * GET /api/calls
 */
async function getAllCalls(req, res, next) {
  try {
    const result = await query(`
      SELECT cs.*, c.full_name, c.phone_number, c.email, j.title as job_title
      FROM call_sessions cs
      JOIN candidates c ON cs.candidate_id = c.candidate_id
      LEFT JOIN jobs j ON cs.job_id = j.job_id
      ORDER BY cs.created_at DESC
      LIMIT 100
    `);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Stream cached or dynamic ElevenLabs audio for telephony <Play> tags
 * GET /api/calls/audio?h=HASH&t=TEXT&v=VOICE
 * GET /api/calls/audio/:hash
 */
async function streamCallAudio(req, res, next) {
  try {
    const hash = req.params.hash || req.query.h;
    const text = req.query.t;
    const voiceId = req.query.v;

    // 1. Try cache by hash
    if (hash && elevenLabsService.isAudioCached(hash)) {
      const buffer = elevenLabsService.getCachedAudio(hash);
      res.set('Content-Type', 'audio/mpeg');
      res.set('Cache-Control', 'public, max-age=604800');
      return res.send(buffer);
    }

    // 2. Synthesize with text if provided
    if (text && elevenLabsService.isConfigured()) {
      const buffer = await elevenLabsService.generateSpeech({ text, voiceId, useCache: true });
      res.set('Content-Type', 'audio/mpeg');
      res.set('Cache-Control', 'public, max-age=604800');
      return res.send(buffer);
    }

    return res.status(404).send('Audio not found');
  } catch (error) {
    console.error('[Audio Streaming] Error:', error.message);
    res.status(502).send('Audio synthesis error: ' + error.message);
  }
}

/**
 * Vapi webhook handler
 * POST /api/calls/vapi-webhook
 *
 * Vapi fires this for: call-started, call-ended, transcript, hang, function-call
 * We use it to:
 *  - Update call status in real-time
 *  - Save the full transcript when the call ends
 *  - Trigger NLP extraction automatically
 */
async function handleVapiWebhook(req, res) {
  try {
    res.status(200).json({ received: true }); // Acknowledge immediately

    const parsed = vapiService.parseWebhook(req.body);
    console.log(`[Vapi Webhook] type=${parsed.type} vapiCallId=${parsed.vapiCallId} internalId=${parsed.internalCallId}`);

    const { type, vapiCallId, internalCallId, transcript, recordingUrl, status, durationSeconds } = parsed;

    // Find the call session — by our internal callId (preferred) or by vapi call SID
    let callRow = null;
    if (internalCallId) {
      const r = await query('SELECT * FROM call_sessions WHERE call_id = $1', [internalCallId]);
      if (r.rows.length > 0) callRow = r.rows[0];
    }
    if (!callRow && vapiCallId) {
      const r = await query('SELECT * FROM call_sessions WHERE twilio_call_sid = $1', [vapiCallId]);
      if (r.rows.length > 0) callRow = r.rows[0];
    }

    if (!callRow) {
      console.warn('[Vapi Webhook] No matching call session found — skipping DB update.');
      return;
    }

    const callId = callRow.call_id;

    if (type === 'call-started') {
      await query(`UPDATE call_sessions SET call_status = 'ringing', twilio_call_sid = $1 WHERE call_id = $2`,
        [vapiCallId, callId]);
    }

    if (type === 'call-ended') {
      const finalStatus = parsed.endedReason === 'customer-ended-call' || parsed.endedReason === 'assistant-ended-call'
        ? 'completed' : (parsed.endedReason || 'completed');

      await query(`
        UPDATE call_sessions
        SET call_status = $1,
            call_end_time = CURRENT_TIMESTAMP,
            recording_url = COALESCE($2, recording_url),
            transcript_text = COALESCE($3, transcript_text)
        WHERE call_id = $4
      `, [finalStatus, recordingUrl || null, transcript || null, callId]);

      // Auto-run NLP if transcript is present
      if (transcript && transcript.trim()) {
        try {
          const extracted = await nlpService.extractStructuredResponses(transcript);
          if (extracted && extracted.length > 0) {
            for (const item of extracted) {
              await query(`
                INSERT INTO candidate_responses (call_id, question_code, response_text, response_value)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT DO NOTHING
              `, [callId, item.question_code, item.response_text, item.response_value]);
            }
            const confidence = extracted.length >= 4 ? 0.93 : 0.75;
            await query('UPDATE call_sessions SET ai_confidence = $1 WHERE call_id = $2', [confidence, callId]);
          }
        } catch (nlpErr) {
          console.error('[Vapi Webhook] NLP extraction error:', nlpErr.message);
        }
      }
    }

    if (type === 'transcript' && transcript) {
      // Streaming partial transcript update
      await query('UPDATE call_sessions SET transcript_text = $1 WHERE call_id = $2', [transcript, callId]);
    }

  } catch (err) {
    console.error('[Vapi Webhook] Error:', err.message);
  }
}

module.exports = {
  initiateCall,
  directCall,
  getCallStatus,
  handleTwilioWebhook,
  handleExotelWebhook,
  handleVapiWebhook,
  generateCallTwiML,
  generateExotelXml,
  handleSpeechGather,
  handleExotelGather,
  streamCallAudio,
  getCallRecording,
  getCallTranscript,
  processNlpForCall,
  getAllCalls,
};
