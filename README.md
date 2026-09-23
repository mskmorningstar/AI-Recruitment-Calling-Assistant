# AI Recruitment Calling Assistant

A fully automated system that conducts outbound recruitment calls using AI voice technology. It integrates with multiple APIs to manage the entire recruitment calling workflow from candidate sourcing to interview scheduling.

## 🏗️ Architecture & Technology Stack

- **Backend**: Node.js & Express.js
- **Database**: PostgreSQL (Supabase Pooler) with strict relational schema
- **Telephony & Recording**: Twilio Voice API
- **Dynamic Text-to-Speech (TTS)**: ElevenLabs API
- **Speech-to-Text (STT)**: AssemblyAI API
- **NLP Extraction & FAQ Engine**: OpenAI GPT-4o / Claude
- **Interview Scheduling**: Google Calendar API (`freeBusy.query` & `events.insert`)
- **ATS Sync**: Greenhouse Harvest API & CSV batch uploads
- **Security & Compliance**: AES-256-GCM field encryption, rate limiting, GDPR data erasure, audit logging

---

## 🚀 Quick Setup & Installation

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` and verify your API keys and database credentials:
```bash
cp .env.example .env
```

Your database connection string is pre-configured to your Supabase PostgreSQL database:
```env
DATABASE_URL=postgresql://postgres.zmjnlmpdqntcxpqqjnds:recruitmentcallingassistant@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres
```

### 3. Run Database Migrations
Create the 6 core tables (`recruiters`, `jobs`, `candidates`, `call_sessions`, `candidate_responses`, `interview_schedules`) and `api_audit_logs`:
```bash
npm run migrate
```

### 4. (Optional) Seed Sample Data
```bash
npm run seed
```

### 5. Start the Application
```bash
# Development mode with nodemon
npm run dev

# Production mode
npm start
```

Access the interactive Recruiter Console at **`http://localhost:3000`**.

---

## 📡 API Endpoints Reference

### Candidate Management
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/candidates` | Fetch all candidates |
| `GET` | `/api/candidates/:id` | Get specific candidate and call history |
| `POST` | `/api/candidates/upload` | Upload candidates via CSV (`multipart/form-data`) |
| `PATCH` | `/api/candidates/:id` | Update candidate details |
| `DELETE` | `/api/candidates/:id` | GDPR compliance deletion (permanently removes candidate) |

### Job Management
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/jobs` | Fetch all open job roles |
| `GET` | `/api/jobs/:id` | Get specific job description |
| `POST` | `/api/jobs` | Create new job posting |
| `POST` | `/api/jobs/sync` | Sync jobs from ATS API (Greenhouse) |

### Outbound Call Management
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/calls/initiate` | Initiate outbound AI call (`{ candidateId, jobId }`) |
| `GET` | `/api/calls/:id/status` | Get real-time call status |
| `POST` | `/api/calls/webhook` | Twilio status callback webhook |
| `POST` | `/api/calls/twiml` | Dynamic TwiML generator for speech dialogue |
| `POST` | `/api/calls/gather` | Captures candidate voice response and prompts next question |
| `GET` | `/api/calls/:id/recording` | Get Twilio call recording MP3 link |
| `GET` | `/api/calls/:id/transcript` | Get full transcript & structured extracted responses |
| `POST` | `/api/calls/:id/process-nlp` | Run OpenAI NLP extraction on call transcript |

### Interview Scheduling
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/interviews/availability` | Query Google Calendar `freeBusy` slots |
| `POST` | `/api/interviews/schedule` | Schedule interview (`{ candidateId, jobId, interviewDate, interviewTime, interviewerEmail }`) |
| `PATCH` | `/api/interviews/:id` | Reschedule interview |
| `DELETE` | `/api/interviews/:id` | Cancel interview and delete calendar event |

### Analytics & Reporting
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/analytics/calls` | Total calls, success rates, duration |
| `GET` | `/api/analytics/candidates` | Parsed salary expectations, notice periods |
| `GET` | `/api/reports/transcripts` | AI confidence score metrics & recent transcripts |

---

## 🔒 Security, Privacy & GDPR Compliance

1. **GDPR Right to Erasure**: `DELETE /api/candidates/:id` permanently removes the candidate, their call records, and responses from the database.
2. **Audit Logging**: Every API request and security event is recorded in the `api_audit_logs` table.
3. **Data Protection at Rest**: Sensitive candidate contact details are encrypted using AES-256-GCM via `src/utils/encryption.js`.
4. **Rate Limiting**: Configured across endpoints to prevent DDoS and spamming of outbound voice minutes.
