-- R7 Partner 450: owner-scoped services, one-level rewards and test-only payments.
-- Run on disposable PostgreSQL 16 first; this does NOT migrate SQLite runtime.
BEGIN;
CREATE TABLE IF NOT EXISTS partner450_orders (
 id TEXT PRIMARY KEY, buyer_id TEXT NOT NULL REFERENCES users(id),org_id TEXT NOT NULL REFERENCES organizations(id),
 package_id TEXT NOT NULL CHECK(package_id IN ('growth_setup_40k','enterprise_setup_200k')),
 amount_cents BIGINT NOT NULL CHECK(amount_cents>0),currency TEXT NOT NULL CHECK(currency='RUB'),
 status TEXT NOT NULL CHECK(status IN ('issued','paid','delivered','accepted','part_refunded','refunded')),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,paid_at TEXT,delivery_note TEXT,delivery_proof_hash TEXT,
 delivered_at TEXT,accepted_at TEXT,acceptance_receipt_hash TEXT,
 refunded_cents BIGINT NOT NULL DEFAULT 0 CHECK(refunded_cents>=0)
);
CREATE INDEX IF NOT EXISTS idx_partner450_org ON partner450_orders(org_id,created_at);
CREATE TABLE IF NOT EXISTS partner450_intents (
 order_id TEXT PRIMARY KEY REFERENCES partner450_orders(id),external_id TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS partner450_payments (
 id TEXT PRIMARY KEY,order_id TEXT NOT NULL UNIQUE REFERENCES partner450_orders(id),
 provider TEXT NOT NULL CHECK(provider IN ('SANDBOX_NO_REAL_MONEY','STRIPE_TEST')),
 external_id TEXT NOT NULL UNIQUE,amount_cents BIGINT NOT NULL CHECK(amount_cents>0),
 refunded_cents BIGINT NOT NULL DEFAULT 0 CHECK(refunded_cents>=0),created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS partner450_commissions (
 id TEXT PRIMARY KEY,order_id TEXT NOT NULL UNIQUE REFERENCES partner450_orders(id),
 buyer_id TEXT NOT NULL UNIQUE REFERENCES users(id),referrer_id TEXT NOT NULL REFERENCES users(id),
 initial_cents BIGINT NOT NULL CHECK(initial_cents>=0),amount_cents BIGINT NOT NULL CHECK(amount_cents>=0),
 status TEXT NOT NULL CHECK(status IN ('pending','test_eligible','void')),
 held_until TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,CHECK(buyer_id<>referrer_id)
);
CREATE INDEX IF NOT EXISTS idx_partner450_referrer ON partner450_commissions(referrer_id,status);
CREATE TABLE IF NOT EXISTS partner450_refunds (
 id TEXT PRIMARY KEY,payment_id TEXT NOT NULL REFERENCES partner450_payments(id),
 external_id TEXT NOT NULL UNIQUE,amount_cents BIGINT NOT NULL CHECK(amount_cents>0),created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS partner450_events (
 event_id TEXT PRIMARY KEY,digest TEXT NOT NULL,created_at TEXT NOT NULL
);
ALTER TABLE partner450_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner450_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE partner450_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner450_commissions FORCE ROW LEVEL SECURITY;
ALTER TABLE partner450_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner450_intents FORCE ROW LEVEL SECURITY;
ALTER TABLE partner450_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner450_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE partner450_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner450_refunds FORCE ROW LEVEL SECURITY;
ALTER TABLE partner450_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner450_events FORCE ROW LEVEL SECURITY;
-- This privileged group reads only own orders and earned commissions;
-- writes and provider events remain server-worker-only. No RLS bypass or public API to keys.
GRANT SELECT ON partner450_orders,partner450_commissions TO proof_app;
CREATE POLICY p450_order_buyer_read ON partner450_orders FOR SELECT TO proof_app
 USING (buyer_id=proof.actor_id());
CREATE POLICY p450_commission_referrer_read ON partner450_commissions FOR SELECT TO proof_app
 USING (referrer_id=proof.actor_id());
COMMIT;
