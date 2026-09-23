-- PostgreSQL Schema for AI Recruitment Calling Assistant

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Recruiters
CREATE TABLE IF NOT EXISTS recruiters (
    recruiter_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name VARCHAR(150) NOT NULL,
    phone_number VARCHAR(20),
    email VARCHAR(150) NOT NULL UNIQUE,
    company_name VARCHAR(150) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Jobs
CREATE TABLE IF NOT EXISTS jobs (
    job_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(150) NOT NULL,
    company_name VARCHAR(150) NOT NULL,
    location VARCHAR(150),
    employment_type VARCHAR(50),
    salary_range VARCHAR(50),
    jd_text TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Candidates
CREATE TABLE IF NOT EXISTS candidates (
    candidate_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name VARCHAR(150) NOT NULL,
    phone_number VARCHAR(20) NOT NULL,
    email VARCHAR(150) NOT NULL,
    source VARCHAR(50) DEFAULT 'ATS',
    ats_id VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Call Sessions
CREATE TABLE IF NOT EXISTS call_sessions (
    call_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    candidate_id UUID NOT NULL REFERENCES candidates(candidate_id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(job_id) ON DELETE SET NULL,
    twilio_call_sid VARCHAR(100),
    call_start_time TIMESTAMP WITH TIME ZONE,
    call_end_time TIMESTAMP WITH TIME ZONE,
    call_status VARCHAR(20) DEFAULT 'initiated',
    recording_url TEXT,
    transcript_text TEXT,
    ai_confidence DECIMAL(5,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Candidate Responses
CREATE TABLE IF NOT EXISTS candidate_responses (
    response_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    call_id UUID NOT NULL REFERENCES call_sessions(call_id) ON DELETE CASCADE,
    question_code VARCHAR(50) NOT NULL,
    response_text TEXT,
    response_value VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Interview Schedules
CREATE TABLE IF NOT EXISTS interview_schedules (
    schedule_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    candidate_id UUID NOT NULL REFERENCES candidates(candidate_id) ON DELETE CASCADE,
    job_id UUID NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
    interview_date DATE NOT NULL,
    interview_time TIME NOT NULL,
    interviewer_name VARCHAR(150),
    calendar_event_id VARCHAR(150),
    status VARCHAR(20) DEFAULT 'scheduled',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. API Audit Logs (Security, monitoring & compliance)
CREATE TABLE IF NOT EXISTS api_audit_logs (
    log_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    method VARCHAR(10) NOT NULL,
    endpoint VARCHAR(255) NOT NULL,
    status_code INTEGER,
    response_time_ms INTEGER,
    client_ip VARCHAR(50),
    user_agent TEXT,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_candidates_email ON candidates(email);
CREATE INDEX IF NOT EXISTS idx_candidates_phone ON candidates(phone_number);
CREATE INDEX IF NOT EXISTS idx_call_sessions_candidate ON call_sessions(candidate_id);
CREATE INDEX IF NOT EXISTS idx_call_sessions_status ON call_sessions(call_status);
CREATE INDEX IF NOT EXISTS idx_candidate_responses_call ON candidate_responses(call_id);
CREATE INDEX IF NOT EXISTS idx_candidate_responses_code ON candidate_responses(question_code);
CREATE INDEX IF NOT EXISTS idx_interview_schedules_candidate ON interview_schedules(candidate_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON api_audit_logs(created_at);
