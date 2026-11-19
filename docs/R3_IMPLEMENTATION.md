# R3 — implementation detail and acceptance matrix

| Block | Source files | Verified locally | Remaining gate |
| --- | --- | --- | --- |
| Next.js 16.4.6 / React 19.3.1 responsive RU/EN App Router + typed finance/BFF | `web-next/` | TSX parse and pure TS typecheck | npm install, typecheck, next build, real browser E2E |
| PG schema, tenant RLS and SQLite export/replay/transactional loader | `db/postgres/`, `migration/` | export hash, FK-ordered replay, content tampering rejection | live PostgreSQL SQL execution/RLS and cutover rollback |
| Stripe TEST-native events and PaymentIntent API | `src/stripe-test.mjs`, `src/server.mjs` | HMAC/timestamp, amount match, refunds, repeats, replay | real merchant test credentials, provider reconciliation, payment UI |
| Referral compliance and dual-control preparation | `src/services.mjs`, R3 schema | consent, challenge, manual identity, independent reviewer, refund revocation | actual email/KYC/tax docs/legal opinion; real payouts disabled |
| Ops/staging/monitoring | `src/metrics.mjs`, `scripts/`, `deploy/`, workflow | metrics auth, preflight, recovery drill, HTTP regression | Docker startup, TLS, offsite encrypted backup, alerts, secret manager |

## Zero-trust financial boundaries

- Tests use `stripe_test` + signed native webhook, or original `sandbox` simulation. `NODE_ENV=production` refuses all test payment modes.
- Provider-created PaymentIntents use integer amount from the persisted invoice and fixed idempotency key. Signature verification occurs **before** JSON interpretation and business mutation.
- Verified refund re-evaluates referral obligation and may revoke a previously prepared offline payout batch. R3 stores the revoked status and does **not** transfer any money.
- Test email tokens are returned only when the server is explicitly started with `EMAIL_TEST_MODE=1` outside production.
- Second reviewer must differ from payout beneficiary and the original approving administrator.
- No private customer link, password, token or third-party session is used as a Prometheus metric label.

## Release boundary

**The local Node/SQLite R3 backend is runnable.** The new Next frontend is source-delivered but lacks installed runtime dependencies and an executed Next build. PostgreSQL artifacts are migration-ready source only, not an applied live migration. External payment/identity providers are absent. Deployments are configuration source, not proof of a deployed service.
