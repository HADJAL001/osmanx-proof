-- CI-only policy smoke; run after 001 and 002 in an ephemeral Postgres instance.
INSERT INTO users(id,email,display_name,password_hash,created_at) VALUES
 ('u_alice','alice@smoke.invalid','Alice','not-a-real-password','2026-11-19T00:00:00Z'),
 ('u_bob','bob@smoke.invalid','Bob','not-a-real-password','2026-11-19T00:00:00Z');
INSERT INTO organizations(id,name,created_at) VALUES
 ('o_alice','A','2026-11-19T00:00:00Z'),('o_bob','B','2026-11-19T00:00:00Z');
INSERT INTO memberships(user_id,org_id,role,created_at) VALUES
 ('u_alice','o_alice','owner','2026-11-19T00:00:00Z'),('u_bob','o_bob','owner','2026-11-19T00:00:00Z');
INSERT INTO quotes(id,org_id,created_by,title,created_at,updated_at) VALUES
 ('q_alice','o_alice','u_alice','A','2026-11-19T00:00:00Z','2026-11-19T00:00:00Z'),
 ('q_bob','o_bob','u_bob','B','2026-11-19T00:00:00Z','2026-11-19T00:00:00Z');
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='proof_test_app') THEN CREATE ROLE proof_test_app NOLOGIN; END IF; END $$;
GRANT USAGE ON SCHEMA public,proof TO proof_test_app;
GRANT SELECT ON organizations,memberships,quotes TO proof_test_app;
BEGIN;
SET LOCAL ROLE proof_test_app;
SELECT set_config('app.user_id','u_alice',true);
DO $ BEGIN IF (SELECT COUNT(*) FROM quotes) <> 1 THEN RAISE EXCEPTION 'RLS smoke failed: alice_only_quotes'; END IF; END $;
DO $ BEGIN IF (SELECT COUNT(*) FROM organizations) <> 1 THEN RAISE EXCEPTION 'RLS smoke failed: alice_only_orgs'; END IF; END $;
COMMIT;
BEGIN;
SET LOCAL ROLE proof_test_app;
SELECT set_config('app.user_id','u_bob',true);
DO $ BEGIN IF (SELECT COUNT(*) FROM quotes) <> 1 THEN RAISE EXCEPTION 'RLS smoke failed: bob_only_quotes'; END IF; END $;
COMMIT;
BEGIN;
SET LOCAL ROLE proof_test_app;
DO $ BEGIN IF (SELECT COUNT(*) FROM quotes) <> 0 THEN RAISE EXCEPTION 'RLS smoke failed: no_context_denied'; END IF; END $;
COMMIT;
