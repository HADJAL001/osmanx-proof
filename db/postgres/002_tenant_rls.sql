-- PostgreSQL tenant isolation for content accessed by the application role.
-- Trust boundary: the backend, not a browser-supplied user ID, must SET LOCAL app.user_id
-- in a transaction after authenticating a real session. App role must not be table owner
-- or possess BYPASSRLS. Privileged workers use a distinct, audited DB role.
CREATE SCHEMA IF NOT EXISTS proof;
CREATE OR REPLACE FUNCTION proof.actor_id() RETURNS text LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('app.user_id', true),'') $$;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_share_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_voids ENABLE ROW LEVEL SECURITY;
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_intents ENABLE ROW LEVEL SECURITY;

-- Self-only membership viewing. An owner editing others is handled by audited workers
-- until an independently reviewed SECURITY DEFINER authorization function is available.
CREATE POLICY membership_self ON memberships FOR SELECT USING (user_id=proof.actor_id());
CREATE POLICY org_member_read ON organizations FOR SELECT USING
 (EXISTS (SELECT 1 FROM memberships m WHERE m.org_id=organizations.id AND m.user_id=proof.actor_id()));
CREATE POLICY quote_member_read ON quotes FOR SELECT USING
 (EXISTS (SELECT 1 FROM memberships m WHERE m.org_id=quotes.org_id AND m.user_id=proof.actor_id()));
CREATE POLICY quote_member_write ON quotes FOR ALL USING
 (EXISTS (SELECT 1 FROM memberships m WHERE m.org_id=quotes.org_id AND m.user_id=proof.actor_id() AND m.role IN ('owner','editor')))
 WITH CHECK (EXISTS (SELECT 1 FROM memberships m WHERE m.org_id=quotes.org_id AND m.user_id=proof.actor_id() AND m.role IN ('owner','editor')));
CREATE POLICY quote_items_reader ON quote_items FOR SELECT USING
 (EXISTS (SELECT 1 FROM quotes q WHERE q.id=quote_items.quote_id));
CREATE POLICY quote_items_writer ON quote_items FOR ALL USING
 (EXISTS (SELECT 1 FROM quotes q JOIN memberships m ON m.org_id=q.org_id WHERE q.id=quote_items.quote_id AND m.user_id=proof.actor_id() AND m.role IN ('owner','editor')))
 WITH CHECK (EXISTS (SELECT 1 FROM quotes q JOIN memberships m ON m.org_id=q.org_id WHERE q.id=quote_items.quote_id AND m.user_id=proof.actor_id() AND m.role IN ('owner','editor')));
CREATE POLICY quote_shares_reader ON quote_shares FOR SELECT USING
 (EXISTS (SELECT 1 FROM quotes q WHERE q.id=quote_shares.quote_id));
CREATE POLICY quote_versions_reader ON quote_versions FOR SELECT USING
 (EXISTS (SELECT 1 FROM quotes q WHERE q.id=quote_versions.quote_id));
CREATE POLICY quote_share_versions_reader ON quote_share_versions FOR SELECT USING
 (EXISTS (SELECT 1 FROM quotes q WHERE q.id=quote_share_versions.quote_id));
CREATE POLICY quote_responses_reader ON quote_responses FOR SELECT USING
 (EXISTS (SELECT 1 FROM quotes q WHERE q.id=quote_responses.quote_id));
CREATE POLICY subscriptions_read ON subscriptions FOR SELECT USING
 (EXISTS (SELECT 1 FROM memberships m WHERE m.org_id=subscriptions.org_id AND m.user_id=proof.actor_id()));
CREATE POLICY preferences_read ON subscription_preferences FOR SELECT USING
 (EXISTS (SELECT 1 FROM memberships m WHERE m.org_id=subscription_preferences.org_id AND m.user_id=proof.actor_id()));
CREATE POLICY invoices_read ON invoices FOR SELECT USING
 (EXISTS (SELECT 1 FROM memberships m WHERE m.org_id=invoices.org_id AND m.user_id=proof.actor_id()));
CREATE POLICY invoice_voids_read ON invoice_voids FOR SELECT USING
 (EXISTS (SELECT 1 FROM invoices i WHERE i.id=invoice_voids.invoice_id));
CREATE POLICY disputes_read ON disputes FOR SELECT USING
 (EXISTS (SELECT 1 FROM memberships m WHERE m.org_id=disputes.org_id AND m.user_id=proof.actor_id()));
CREATE POLICY invitations_read ON invitations FOR SELECT USING
 (EXISTS (SELECT 1 FROM memberships m WHERE m.org_id=invitations.org_id AND m.user_id=proof.actor_id()));
CREATE POLICY provider_intents_read ON provider_intents FOR SELECT USING
 (EXISTS (SELECT 1 FROM invoices i WHERE i.id=provider_intents.invoice_id));

-- All financial writes on PostgreSQL must use the privileged, audited service role.
-- App role receives only SELECT on these tables; mutations are deliberately default-DENY.
-- Hardening steps before rollout: strip PUBLIC privileges, create non-owner app role, verify RLS with a live PostgreSQL DB,
-- test row visibility and insert/update policy matrix, and replace privileged bypasses with targeted stored procedures.
