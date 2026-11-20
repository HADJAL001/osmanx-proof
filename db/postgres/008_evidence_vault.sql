-- R6: encrypted attachments metadata, immutable submission binding and acceptance receipts.
-- Ciphertexts remain outside PostgreSQL in an owner-only AES-256-GCM vault.
-- Apply AFTER 006_workflow.sql. No public grants, no grants to modify audit evidence.
CREATE TABLE IF NOT EXISTS work_evidence (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES work_projects(id),
 milestone_id TEXT NOT NULL REFERENCES work_milestones(id),
 file_name TEXT NOT NULL,
 mime_type TEXT NOT NULL CHECK (mime_type IN ('application/pdf','image/png','image/jpeg','text/plain')),
 size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 2097152),
 sha256 TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'quarantined' CHECK(status IN ('quarantined','cleared','rejected','revoked')),
 scan_engine TEXT, scanned_at TEXT, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_work_evidence_milestone ON work_evidence(milestone_id,created_at);
CREATE TABLE IF NOT EXISTS work_submission_evidence (
 submission_id TEXT NOT NULL REFERENCES work_submissions(id),
 evidence_id TEXT NOT NULL REFERENCES work_evidence(id),
 PRIMARY KEY(submission_id,evidence_id)
);
CREATE TABLE IF NOT EXISTS work_acceptance_receipts (
 id TEXT PRIMARY KEY,
 response_id TEXT NOT NULL UNIQUE REFERENCES work_client_responses(id),
 submission_id TEXT NOT NULL UNIQUE REFERENCES work_submissions(id),
 project_id TEXT NOT NULL REFERENCES work_projects(id),
 receipt_json TEXT NOT NULL, receipt_sha256 TEXT NOT NULL, created_at TEXT NOT NULL
);
ALTER TABLE work_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_submission_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_acceptance_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE work_submission_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE work_acceptance_receipts FORCE ROW LEVEL SECURITY;
-- proof_app is explicitly read-only. A separate audited service role is responsible for writes.
GRANT SELECT ON work_evidence,work_submission_evidence,work_acceptance_receipts TO proof_app;
CREATE POLICY evidence_member_read ON work_evidence FOR SELECT USING
 (EXISTS (SELECT 1 FROM work_projects p WHERE p.id=work_evidence.project_id));
CREATE POLICY submission_evidence_member_read ON work_submission_evidence FOR SELECT USING
 (EXISTS (SELECT 1 FROM work_submissions s WHERE s.id=work_submission_evidence.submission_id));
CREATE POLICY acceptance_receipts_member_read ON work_acceptance_receipts FOR SELECT USING
 (EXISTS (SELECT 1 FROM work_projects p WHERE p.id=work_acceptance_receipts.project_id));
-- Do NOT grant SELECT on work_client_shares, whose token hashes must remain private.
