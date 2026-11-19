# R3 — next five engineering blocks (not implemented)

1. **Next.js + TypeScript user application:** migrate the R2 UI to typed React components; SSR boundaries, mobile navigation, route guards, accessibility; prevent regression with component/browser tests.
2. **PostgreSQL + tenant RLS:** write migration from SQLite R1/R2 including ledger and audit historical checks, worker outbox, org scoped policies and cutover/rollback rehearsal with staging PostgreSQL.
3. **Provider-specific payment integration:** only after choosing a merchant acquiring provider and obtaining test keys; implement the provider's native signature algorithm, reconciliation by signed reports/API, refunds, idempotency and operational incident policy. Do not permit real money during testing without merchant/legal approvals.
4. **Identity, payout and legal compliance:** verified email, identity checks proportionate to payout risk, consent retention and data deletion, legally correct commission documents and settlement rules; real payouts only after jurisdiction/legal/tax review.
5. **Production candidate:** Docker/managed infrastructure, TLS, secrets manager, backups encrypted off-site, staging E2E desktop/mobile, load/fault recovery, dashboards/alerts, penetration/security review and rollback.

R2 remains intentionally SQLite-backed to keep completed features testable in an environment with no running PostgreSQL, package registry, Docker daemon or real acquiring credentials. Nothing above should be represented as complete.
