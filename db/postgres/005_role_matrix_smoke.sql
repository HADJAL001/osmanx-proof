-- Run via psql -v ON_ERROR_STOP=1 as an admin after 001,002,004,003.
-- Requires fixtures u_alice,o_alice,q_alice and u_bob,o_bob,q_bob from 003.
-- Grant proof_app membership to the admin executing smoke or use a superuser in staging.
BEGIN;
SET LOCAL ROLE proof_app;
SELECT set_config('app.user_id','u_alice',true);
SELECT CASE WHEN (SELECT count(*) FROM quotes)=1 THEN 1 ELSE 1/0 END AS alice_sees_one;
SELECT CASE WHEN (SELECT count(*) FROM organizations)=1 THEN 1 ELSE 1/0 END AS alice_sees_one_org;
DO $$ BEGIN
 BEGIN
   INSERT INTO quotes(id,org_id,created_by,title,created_at,updated_at)
   VALUES ('q_rls_unauthorized','o_bob','u_alice','cross','2026-11-20','2026-11-20');
   RAISE EXCEPTION 'RLS FAILED: cross-tenant insertion accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
INSERT INTO quotes(id,org_id,created_by,title,created_at,updated_at)
VALUES ('q_rls_allowed','o_alice','u_alice','same-tenant','2026-11-20','2026-11-20');
SELECT CASE WHEN (SELECT count(*) FROM quotes)=2 THEN 1 ELSE 1/0 END AS own_insert_visible;
ROLLBACK;
BEGIN;
SET LOCAL ROLE proof_app;
SELECT set_config('app.user_id','u_bob',true);
SELECT CASE WHEN (SELECT count(*) FROM quotes)=1 THEN 1 ELSE 1/0 END AS bob_sees_one;
ROLLBACK;
BEGIN;
SET LOCAL ROLE proof_app;
SELECT CASE WHEN (SELECT count(*) FROM quotes)=0 THEN 1 ELSE 1/0 END AS unauthenticated_zero;
ROLLBACK;
