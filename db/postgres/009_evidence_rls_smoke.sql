-- Run on disposable PostgreSQL AFTER R5 smoke tests seeded Alice's project.
INSERT INTO work_submissions(id,milestone_id,revision,summary,content_hash,submitted_by,created_at)
 VALUES('r6_submission_alice','r5_milestone_alice',1,'Signed-off R6 test fixture','sha-fixture','u_alice','2026-11-20');
INSERT INTO work_evidence(id,project_id,milestone_id,file_name,mime_type,size_bytes,sha256,status,created_by,created_at)
 VALUES('r6_evidence_alice','r5_project_alice','r5_milestone_alice','proof.txt','text/plain',5,'fixture-digest','cleared','u_alice','2026-11-20');
INSERT INTO work_submission_evidence(submission_id,evidence_id) VALUES('r6_submission_alice','r6_evidence_alice');
BEGIN;
SET LOCAL ROLE proof_app;
SELECT set_config('app.user_id','u_alice',true);
SELECT 1 / CASE WHEN (SELECT count(*) FROM work_evidence)=1 THEN 1 ELSE 0 END AS alice_sees_evidence;
SELECT 1 / CASE WHEN (SELECT count(*) FROM work_submission_evidence)=1 THEN 1 ELSE 0 END AS alice_sees_submission_link;
SELECT 1 / CASE WHEN has_table_privilege('proof_app','work_evidence','UPDATE')=false THEN 1 ELSE 0 END AS cannot_update_evidence;
SELECT 1 / CASE WHEN has_table_privilege('proof_app','work_client_shares','SELECT')=false THEN 1 ELSE 0 END AS cannot_read_tokens;
ROLLBACK;
BEGIN;
SET LOCAL ROLE proof_app;
SELECT set_config('app.user_id','u_bob',true);
SELECT 1 / CASE WHEN (SELECT count(*) FROM work_evidence)=0 THEN 1 ELSE 0 END AS bob_cannot_see_evidence;
SELECT 1 / CASE WHEN (SELECT count(*) FROM work_submission_evidence)=0 THEN 1 ELSE 0 END AS bob_cannot_see_link;
ROLLBACK;
BEGIN;
SET LOCAL ROLE proof_app;
SELECT 1 / CASE WHEN (SELECT count(*) FROM work_evidence)=0 THEN 1 ELSE 0 END AS anonymous_cannot_see_evidence;
ROLLBACK;
