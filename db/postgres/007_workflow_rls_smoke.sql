-- CI smoke: R5 rows are only visible to their owning org; no tokens readable.
INSERT INTO quote_shares(id,quote_id,token_hash,expires_at,created_at) VALUES
 ('r5_share_alice','q_alice','fake-hash-only-ci','2099-01-01','2026-11-20');
INSERT INTO quote_responses(id,share_id,quote_id,revision,snapshot_hash,decision,responder_name,created_at)
 VALUES ('r5_response_alice','r5_share_alice','q_alice',1,'fixture','accepted','Alice','2026-11-20');
INSERT INTO work_projects(id,org_id,quote_id,quote_revision,accepted_response_id,title,client_name,total_cents,created_by,created_at,updated_at)
 VALUES ('r5_project_alice','o_alice','q_alice',1,'r5_response_alice','A','Client',1000,'u_alice','2026-11-20','2026-11-20');
INSERT INTO work_milestones(id,project_id,position,title,created_at,updated_at)
 VALUES ('r5_milestone_alice','r5_project_alice',1,'Test milestone','2026-11-20','2026-11-20');
BEGIN;
SET LOCAL ROLE proof_app;
SELECT set_config('app.user_id','u_alice',true);
SELECT CASE WHEN (SELECT count(*) FROM work_projects)=1 THEN 1 ELSE 1/0 END AS own_project_only;
SELECT CASE WHEN (SELECT count(*) FROM work_milestones)=1 THEN 1 ELSE 1/0 END AS own_milestone_only;
ROLLBACK;
BEGIN;
SET LOCAL ROLE proof_app;
SELECT set_config('app.user_id','u_bob',true);
SELECT CASE WHEN (SELECT count(*) FROM work_projects)=0 THEN 1 ELSE 1/0 END AS bob_cannot_see_alice;
SELECT CASE WHEN (SELECT count(*) FROM work_milestones)=0 THEN 1 ELSE 1/0 END AS bob_cannot_see_milestone;
ROLLBACK;
BEGIN;
SET LOCAL ROLE proof_app;
SELECT CASE WHEN (SELECT count(*) FROM work_projects)=0 THEN 1 ELSE 1/0 END AS anonymous_cannot_see_work;
ROLLBACK;
