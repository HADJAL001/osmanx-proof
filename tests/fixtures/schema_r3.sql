PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
 password_hash TEXT NOT NULL, locale TEXT NOT NULL DEFAULT 'ru' CHECK(locale IN ('ru','en')),
 is_admin INTEGER NOT NULL DEFAULT 0, signup_ip_hash TEXT, referred_by TEXT REFERENCES users(id),
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS organizations (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
 user_id TEXT NOT NULL REFERENCES users(id), org_id TEXT NOT NULL REFERENCES organizations(id),
 role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),
 created_at TEXT NOT NULL, PRIMARY KEY(user_id,org_id)
);
CREATE TABLE IF NOT EXISTS invitations (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), email TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('editor','viewer')), token_hash TEXT NOT NULL UNIQUE,
 expires_at TEXT NOT NULL, accepted_at TEXT, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 csrf_token TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS quotes (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id), created_by TEXT NOT NULL REFERENCES users(id),
 title TEXT NOT NULL, client_name TEXT NOT NULL DEFAULT '', client_email TEXT NOT NULL DEFAULT '',
 currency TEXT NOT NULL DEFAULT 'RUB', discount_cents INTEGER NOT NULL DEFAULT 0 CHECK(discount_cents >= 0),
 tax_bps INTEGER NOT NULL DEFAULT 0 CHECK(tax_bps BETWEEN 0 AND 10000),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','accepted','cancelled')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quote_items (
 id TEXT PRIMARY KEY, quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
 description TEXT NOT NULL, qty INTEGER NOT NULL CHECK(qty BETWEEN 1 AND 10000),
 unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents BETWEEN 0 AND 100000000000),
 unit_cost_cents INTEGER NOT NULL CHECK(unit_cost_cents BETWEEN 0 AND 100000000000),
 position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS quote_shares (
 id TEXT PRIMARY KEY, quote_id TEXT NOT NULL REFERENCES quotes(id), token_hash TEXT NOT NULL UNIQUE,
 expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invoices (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), org_id TEXT NOT NULL REFERENCES organizations(id),
 plan TEXT NOT NULL CHECK(plan='pro'), period_months INTEGER NOT NULL DEFAULT 1 CHECK(period_months=1),
 list_amount_cents INTEGER NOT NULL, discount_cents INTEGER NOT NULL DEFAULT 0,
 total_cents INTEGER NOT NULL CHECK(total_cents>0), currency TEXT NOT NULL DEFAULT 'RUB',
 status TEXT NOT NULL DEFAULT 'issued' CHECK(status IN ('issued','paid','part_refunded','refunded')),
 created_at TEXT NOT NULL, paid_at TEXT
);
CREATE TABLE IF NOT EXISTS payments (
 id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL UNIQUE REFERENCES invoices(id),
 provider TEXT NOT NULL, external_id TEXT NOT NULL UNIQUE, amount_cents INTEGER NOT NULL,
 refunded_cents INTEGER NOT NULL DEFAULT 0, paid_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS refunds (
 id TEXT PRIMARY KEY, payment_id TEXT NOT NULL REFERENCES payments(id),
 external_id TEXT NOT NULL UNIQUE, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subscriptions (
 org_id TEXT PRIMARY KEY REFERENCES organizations(id), plan TEXT NOT NULL DEFAULT 'free',
 active_until TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS referral_codes (
 user_id TEXT PRIMARY KEY REFERENCES users(id), code TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS referral_attributions (
 buyer_id TEXT PRIMARY KEY REFERENCES users(id), referrer_id TEXT NOT NULL REFERENCES users(id),
 code TEXT NOT NULL, created_at TEXT NOT NULL,
 CHECK(buyer_id != referrer_id)
);
CREATE TABLE IF NOT EXISTS referral_rewards (
 id TEXT PRIMARY KEY, payment_id TEXT NOT NULL UNIQUE REFERENCES payments(id),
 referrer_id TEXT NOT NULL REFERENCES users(id), buyer_id TEXT NOT NULL REFERENCES users(id),
 original_cents INTEGER NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
 status TEXT NOT NULL CHECK(status IN ('pending','payable','void','paid')),
 held_until TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger_transactions (
 id TEXT PRIMARY KEY, source_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger_entries (
 id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL REFERENCES ledger_transactions(id),
 account TEXT NOT NULL, debit_cents INTEGER NOT NULL DEFAULT 0 CHECK(debit_cents >= 0),
 credit_cents INTEGER NOT NULL DEFAULT 0 CHECK(credit_cents >= 0),
 CHECK((debit_cents > 0 AND credit_cents = 0) OR (debit_cents = 0 AND credit_cents > 0))
);
CREATE TABLE IF NOT EXISTS webhook_events (
 event_id TEXT PRIMARY KEY, digest TEXT NOT NULL, processed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fraud_flags (
 id TEXT PRIMARY KEY, buyer_id TEXT NOT NULL REFERENCES users(id),
 referrer_id TEXT REFERENCES users(id), kind TEXT NOT NULL, reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','cleared','confirmed')),
 created_at TEXT NOT NULL, reviewed_by TEXT REFERENCES users(id), reviewed_at TEXT
);
CREATE TABLE IF NOT EXISTS disputes (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), org_id TEXT NOT NULL REFERENCES organizations(id),
 subject TEXT NOT NULL, detail TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','rejected')),
 resolution TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payout_requests (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), amount_cents INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','approved','rejected','sent')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_events (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, actor_user_id TEXT,
 action TEXT NOT NULL, entity_id TEXT, metadata_json TEXT NOT NULL,
 prev_hash TEXT NOT NULL, event_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quotes_org ON quotes(org_id,updated_at);
CREATE INDEX IF NOT EXISTS idx_invoices_org ON invoices(org_id,created_at);
CREATE INDEX IF NOT EXISTS idx_reward_referrer ON referral_rewards(referrer_id,status);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_events(action,seq);

-- R2: immutable client approval trail. Existing R1 share links are not implicitly trusted.
CREATE TABLE IF NOT EXISTS quote_versions (
 quote_id TEXT PRIMARY KEY REFERENCES quotes(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1)
);
CREATE TABLE IF NOT EXISTS quote_share_versions (
 share_id TEXT PRIMARY KEY REFERENCES quote_shares(id) ON DELETE CASCADE,
 quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL CHECK(revision >= 1),
 snapshot_hash TEXT NOT NULL,
 revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_share_versions_quote ON quote_share_versions(quote_id,revoked_at);
CREATE TABLE IF NOT EXISTS quote_responses (
 id TEXT PRIMARY KEY, share_id TEXT NOT NULL UNIQUE REFERENCES quote_shares(id),
 quote_id TEXT NOT NULL REFERENCES quotes(id), revision INTEGER NOT NULL,
 snapshot_hash TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('accepted','changes_requested')),
 responder_name TEXT NOT NULL, message TEXT NOT NULL DEFAULT '',
 fingerprint_hash TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quote_responses_quote ON quote_responses(quote_id,created_at);

-- R2: no unapproved recurring charges; cancellation retains an already paid term.
CREATE TABLE IF NOT EXISTS subscription_preferences (
 org_id TEXT PRIMARY KEY REFERENCES organizations(id),
 renewal_state TEXT NOT NULL DEFAULT 'manual' CHECK(renewal_state IN ('manual','stopped')),
 cancelled_at TEXT, resumed_at TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invoice_voids (
 invoice_id TEXT PRIMARY KEY REFERENCES invoices(id), reason TEXT NOT NULL,
 voided_at TEXT NOT NULL, actor_id TEXT REFERENCES users(id)
);

-- R2: operator-entered payment provider settlements are read-only comparisons.
CREATE TABLE IF NOT EXISTS settlement_reports (
 id TEXT PRIMARY KEY, provider TEXT NOT NULL, provider_report_id TEXT NOT NULL,
 digest TEXT NOT NULL, row_count INTEGER NOT NULL, mismatch_count INTEGER NOT NULL,
 result_json TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL, UNIQUE(provider,provider_report_id)
);

-- R3 provider test intent mapping (non-financial until verified webhook arrives).
CREATE TABLE IF NOT EXISTS provider_intents (
 invoice_id TEXT PRIMARY KEY REFERENCES invoices(id), provider TEXT NOT NULL,
 external_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
);

-- R3: consent, manual identity verification, second-person payout release gate.
CREATE TABLE IF NOT EXISTS email_challenges (
 user_id TEXT PRIMARY KEY REFERENCES users(id), token_hash TEXT NOT NULL UNIQUE,
 expires_at TEXT NOT NULL, issued_at TEXT NOT NULL, verified_at TEXT
);
CREATE TABLE IF NOT EXISTS legal_acceptances (
 user_id TEXT NOT NULL REFERENCES users(id), document TEXT NOT NULL, version TEXT NOT NULL,
 accepted_at TEXT NOT NULL, PRIMARY KEY(user_id,document,version)
);
CREATE TABLE IF NOT EXISTS identity_reviews (
 user_id TEXT PRIMARY KEY REFERENCES users(id),
 status TEXT NOT NULL CHECK(status IN ('requested','approved','rejected')),
 reviewed_by TEXT REFERENCES users(id), reviewed_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payout_review_authors (
 request_id TEXT PRIMARY KEY REFERENCES payout_requests(id), reviewer_id TEXT NOT NULL REFERENCES users(id),
 reviewed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payout_preparations (
 request_id TEXT PRIMARY KEY REFERENCES payout_requests(id),
 second_reviewer_id TEXT NOT NULL REFERENCES users(id),
 batch_id TEXT NOT NULL UNIQUE, digest TEXT NOT NULL, created_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','revoked')), revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS privacy_requests (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL CHECK(kind IN ('access','erasure')),
 status TEXT NOT NULL CHECK(status IN ('open','reviewed')),
 created_at TEXT NOT NULL, reviewed_at TEXT
);
