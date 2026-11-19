-- R5 PostgreSQL schema expansion for tracked work and client acknowledgements.
-- Run only after 001 / 002 / 004. Public token reads are done by authenticated backend
-- handlers with TTL/revocation checks; the database role has no direct public grants.
CREATE TABLE IF NOT EXISTS work_projects (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
 quote_id TEXT NOT NULL UNIQUE REFERENCES quotes(id), quote_revision INTEGER NOT NULL,
 accepted_response_id TEXT NOT NULL REFERENCES quote_responses(id),
 title TEXT NOT NULL, client_name TEXT NOT NULL, total_cents BIGINT NOT NULL CHECK(total_cents>=0),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','paused')),
 created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_work_projects_org ON work_projects(org_id,updated_at);
CREATE TABLE IF NOT EXISTS work_milestones (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES work_projects(id), position INTEGER NOT NULL,
 title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', due_at TEXT,
 status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','in_progress','submitted','changes_requested','accepted')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(project_id,position)
);
CREATE TABLE IF NOT EXISTS work_submissions (
 id TEXT PRIMARY KEY, milestone_id TEXT NOT NULL REFERENCES work_milestones(id),
 revision INTEGER NOT NULL CHECK(revision>0), summary TEXT NOT NULL, content_hash TEXT NOT NULL,
 submitted_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, UNIQUE(milestone_id,revision)
);
CREATE TABLE IF NOT EXISTS work_client_shares (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES work_projects(id), token_hash TEXT NOT NULL UNIQUE,
 expires_at TEXT NOT NULL, revoked_at TEXT, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_work_shares_project ON work_client_shares(project_id,revoked_at);
CREATE TABLE IF NOT EXISTS work_client_responses (
 id TEXT PRIMARY KEY, milestone_id TEXT NOT NULL REFERENCES work_milestones(id),
 submission_revision INTEGER NOT NULL, share_id TEXT NOT NULL REFERENCES work_client_shares(id),
 decision TEXT NOT NULL CHECK(decision IN ('accepted','changes_requested')),
 responder_name TEXT NOT NULL, message TEXT NOT NULL, fingerprint_hash TEXT, created_at TEXT NOT NULL,
 UNIQUE(milestone_id,submission_revision)
);
ALTER TABLE work_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_client_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_client_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_projects FORCE ROW LEVEL SECURITY;
ALTER TABLE work_milestones FORCE ROW LEVEL SECURITY;
ALTER TABLE work_submissions FORCE ROW LEVEL SECURITY;
ALTER TABLE work_client_shares FORCE ROW LEVEL SECURITY;
ALTER TABLE work_client_responses FORCE ROW LEVEL SECURITY;
-- SELECT is the only privilege assigned to proof_app; writes are via audited service role.
GRANT SELECT ON work_projects,work_milestones,work_submissions,work_client_responses TO proof_app;
CREATE POLICY work_project_member ON work_projects FOR SELECT USING
 (EXISTS (SELECT 1 FROM memberships m WHERE m.org_id=work_projects.org_id AND m.user_id=proof.actor_id()));
CREATE POLICY work_milestones_member ON work_milestones FOR SELECT USING
 (EXISTS (SELECT 1 FROM work_projects p WHERE p.id=work_milestones.project_id));
CREATE POLICY work_submissions_member ON work_submissions FOR SELECT USING
 (EXISTS (SELECT 1 FROM work_milestones m WHERE m.id=work_submissions.milestone_id));
CREATE POLICY work_client_responses_member ON work_client_responses FOR SELECT USING
 (EXISTS (SELECT 1 FROM work_milestones m WHERE m.id=work_client_responses.milestone_id));
-- No GRANT and no SELECT policy for token hashes, even for org members.
