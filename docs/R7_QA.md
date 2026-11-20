# R7 Quality acceptance

- Existing R1-R5 regression: must remain passing.
- New tests: commercial quote/margin caps, owner-only purchases, free affiliate registration, Stripe TEST signature/reconciliation, test-only sandbox, immutable binding, duplicate events, one commission per unique buyer, physical delivery proof, buyer acceptance, delayed settlement, fraud holds, refund reversals, isolated wallets, public read-only catalogue, CSRF and origin checks.
- PostgreSQL: `db/postgres/010_partner450.sql` + `011_partner450_rls_smoke.sql` on disposable PG16 and proof_app-only RLS.
- Next.js: check `npm run typecheck` + `npm run build` on CI; local network installation may be unavailable.
- No live payments, no real payouts, no automatic tax compliance; no promises of income.
