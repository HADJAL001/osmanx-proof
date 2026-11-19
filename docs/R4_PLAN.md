# R4 — next five major blocks (not implemented)

1. Execute Next.js `npm install`, `typecheck` and `build`; fix all TS and CSS issues and run real Chromium + mobile-device E2E for login, quotes, print and billing.
2. Start actual PostgreSQL 16, run `001_schema.sql` through `003_rls_smoke.sql`, do row-by-row importer validation and complete tenant operation policy matrix including updates and deletes; run live migration/rollback rehearsal.
3. Implement licensed merchant sandbox checkout UI, provider API reconciliation and evidence-based refunds with independently verified settlement reports. No live funds without approval.
4. Integrate verified email delivery, legally approved identity and tax workflow, explicit payout vendor contracts, irreversible export revocation and legal record retention map.
5. Build full observability / production gate: managed TLS and secret storage, encrypted offsite backups, server-side monitoring/alerts, concurrency and abuse load tests, pen-test and blue-green rollback.

Release R4 only after source checks pass; public production and real payouts remain prohibited until independent legal/security review.
