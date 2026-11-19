# R2 local quality report — 19 November 2026

Status: **73 automated tests passed / 73 executed** via `npm run check`, Node.js v22.16.0. This includes 40 retained R1 tests and 33 R2 tests (20 service-level, 9 HTTP-level, 3 backup-level, 1 R1 upgrade case). New tests cover:

- Public customer reply requires consent; validates immutable approval and change requests.
- Quote revision uses optimistic concurrency; older shares are revoked.
- Public page does not expose internal unit cost/margin or client email.
- Admin/owner roles block tenant, refund and subscription misuse.
- Cancelling future purchases voids unpaid invoices and forbids delayed payment callbacks.
- Paid access remains active through its already purchased period; manual resume preserves first eligible discount after a void invoice.
- Reconciliation matches amounts/refunds; detects missing and mismatched entries, duplicates and content-changing report ID reuse.
- Shared-workspace and same-network risk signals hold rewards; recheck can revoke reserved payout requests.
- `/ready` returns 503 when ledger is deliberately made inconsistent.
- SQLite online snapshot, checksum, restored DB equality, corruption detection and no-overwrite constraints.
- Existing R1 data upgrades without lost records; legacy non-versioned sharing tokens are not reused.
- Untrusted `X-Forwarded-For` is ignored.

Visual review: Chromium (offline `set_content` mode) rendered RU desktop/mobile screens and customer approval screens. No browser JavaScript errors were found in this mode. Screenshots: `qa/visual_01_auth.png` through `qa/visual_09_client_approval_mobile.png` (nine images). **Browser navigation to localhost was blocked by host policy** (`net::ERR_BLOCKED_BY_ADMINISTRATOR`), so no live Chromium E2E pass is claimed; independent Node HTTP integration tests exercise real HTTP server endpoints and session/cookie behaviour.

Not validated: Docker build/runtime, Next.js, PostgreSQL, payment processor certificates or real webhooks, remote TLS and DNS, actual refunds/payouts, RLS, cloud backup encryption, legal e-signature and real Android/iOS native packaging.

Release gate: **local development only**. Production release remains blocked.
