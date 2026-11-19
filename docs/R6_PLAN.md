# R6 — five follow-on engineering goals (NOT YET IMPLEMENTED)

1. **Runnable Next.js production build.** Pin/install dependencies on connected CI, execute typecheck, production build and interactive authenticated + public portal E2E on desktop/mobile. Fix issues found with real navigation.
2. **Real PostgreSQL adapter and migration.** Run migrations in disposable PG 16 and test RLS; implement full PostgreSQL read/write repository; compare actual row content and replay WAL/transactions against SQLite; stage rollback under load.
3. **External Stripe TEST account and reconciliation.** Connect an owned, authorized merchant test account, test hosted checkout, independent signed webhooks, refunds, idempotency, mismatched amounts and Stripe reconciliation. Production money remains disabled.
4. **Customer evidence and signed acceptance.** Add attachments with private object storage, virus scanning, retention and revisions; optional verified identity/e-signature vendor when legally reviewed; never equate bearer-link acknowledgement with qualified signature.
5. **Real staging.** Provision private staging TLS, secret manager, offsite encrypted backups, synthetic monitoring, abuse/security scan, load testing, deploy and rollback validation. Only release after evidence-backed gate passes.

All five R6 items require infrastructure/services not available in the current offline container; no automatic completion claim is made.
