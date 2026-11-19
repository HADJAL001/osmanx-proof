# R4 QA evidence and remaining blockers

- Backend `npm test`: 175 / 175 PASS on the local Node.js 22.16.0 runtime.
- `npm run check`: syntax checks for all R4 Node modules and regression tests, PASS.
- Frontend source: 12 `.ts`/`.tsx` files parsed by TypeScript 5.8.3, 0 parse errors; pure TypeScript quote calculation executed with Node type stripping. Full Next.js compilation and runtime typechecking **not performed**: npm registry DNS returned EAI_AGAIN, and no local `node_modules` were available.
- Chromium dynamic HTTP E2E: attempted against the local Node server, blocked by `net::ERR_BLOCKED_BY_ADMINISTRATOR`. Do not count as passed. No live mobile/browser E2E success claim.
- PostgreSQL 16: not installed locally, and no Docker daemon. Only static SQL policy tests and fake-client content reconciliation passed; CI SQL execution configured but not run in this session.
- Stripe: fully local TEST provider fixture including HMAC verification, hosted URL validation, collision/replay handling, refunds and independent reconciliation. No real Stripe API/key/merchant connectivity verified.
- Payout: signed message transport mocked, third-person export lease and revocation tested; no KYC, bank transfer, legal payout approval or tax vendor linked.
- AES-256-GCM backup: encrypted round-trip tests, tampered ciphertext/metadata rejection, wrong-key rejection, no-overwrite and restrictive modes PASS. No remote/offsite backup has been configured.
- Local load smoke: concurrency/abuse test PASS; this does NOT constitute a production load test.
- Live GitHub Actions, staging TLS, independent security review and public domain: NOT performed.

Production publication is blocked. Do not merge this into a live customer billing system without independent staging and compliance verification.

- SQLite additive upgrade: two extra tests verified an R3-generated database preserves users, offers, invoices, audit events and public approval tokens under R4 schema.
