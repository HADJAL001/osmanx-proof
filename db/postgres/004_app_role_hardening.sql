-- R4 PostgreSQL least privilege migration. Run as database administrator AFTER imports.
-- proof_app is a NOLOGIN privilege group, not a public / browser login role.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='proof_app') THEN
 CREATE ROLE proof_app NOLOGIN NOBYPASSRLS;
END IF; END $$;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public, proof TO proof_app;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM proof_app;
-- App server may query only tenant-bound rows. Payments and payout writes stay worker-only.
GRANT SELECT ON organizations,memberships,quotes,quote_items,quote_shares,quote_versions,
 quote_share_versions,quote_responses,subscriptions,subscription_preferences,invoices,
 invoice_voids,disputes,invitations,provider_intents,checkout_sessions TO proof_app;
GRANT INSERT,UPDATE,DELETE ON quotes,quote_items TO proof_app;

ALTER TABLE checkout_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY checkout_sessions_member_read ON checkout_sessions FOR SELECT USING
 (EXISTS (SELECT 1 FROM invoices i WHERE i.id=checkout_sessions.invoice_id));

-- Remove broad ALL write policy and replace with specific author/editor/owner rules.
DROP POLICY IF EXISTS quote_member_write ON quotes;
CREATE POLICY quote_insert ON quotes FOR INSERT WITH CHECK
 (created_by=proof.actor_id() AND EXISTS
  (SELECT 1 FROM memberships m WHERE m.org_id=quotes.org_id
   AND m.user_id=proof.actor_id() AND m.role IN ('owner','editor')));
CREATE POLICY quote_update ON quotes FOR UPDATE USING
 (EXISTS (SELECT 1 FROM memberships m WHERE m.org_id=quotes.org_id
   AND m.user_id=proof.actor_id() AND m.role IN ('owner','editor')))
 WITH CHECK (EXISTS (SELECT 1 FROM memberships m WHERE m.org_id=quotes.org_id
   AND m.user_id=proof.actor_id() AND m.role IN ('owner','editor')));
CREATE POLICY quote_delete ON quotes FOR DELETE USING
 (EXISTS (SELECT 1 FROM memberships m WHERE m.org_id=quotes.org_id
   AND m.user_id=proof.actor_id() AND m.role='owner'));
-- The default policy on financial tables is deny, even if a grant is accidentally widened.
ALTER TABLE checkout_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE quotes FORCE ROW LEVEL SECURITY;
ALTER TABLE quote_items FORCE ROW LEVEL SECURITY;
ALTER TABLE quote_shares FORCE ROW LEVEL SECURITY;
ALTER TABLE quote_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE quote_share_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE quote_responses FORCE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE subscription_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
ALTER TABLE invoice_voids FORCE ROW LEVEL SECURITY;
ALTER TABLE disputes FORCE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
ALTER TABLE provider_intents FORCE ROW LEVEL SECURITY;
-- Never allow runtime app login to connect directly to the database from a public network.
-- The backend sets app.user_id only after authenticating the session; arbitrary SQL access
-- with app_user credentials would be capable of spoofing that GUC, so SQL is not exposed.
