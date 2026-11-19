# R4 implementation / architecture

## 1. Public quote review under Next.js

Next.js now includes `/s/[token]`, `/print.css`, `/print.js`, `/review.js`, and `/api/public/quotes/[token]/respond`. The public endpoint checks same-site origin when supplied, JSON, body size and a strict share token. The backend validates the version/snapshot and one-time response. The authenticated BFF blocks external access to provider webhooks and public quote mutations to avoid accidentally re-routing provider events through an unaudited edge path.

## 2. PostgreSQL cutover

Run disposable staging scripts (never on a real database):

```sh
export DATABASE_URL=postgresql://<test-user>:<test-password>@<test-host>:5432/proof_test
sh deploy/r4-postgres-test.sh
```

Scripts are ordered: 001 schema, 002 RLS, 004 least-privilege runtime role, 003 original fixtures/smoke, 005 write/tenant matrix. The app runtime uses SQLite until migration is performed and separately verified. Importer now fails on any column mismatch or altered field before commit. Exported JSONL contains sensitive information: encrypt and restrict access. PG import requires a privileged migration identity and an empty compatible schema, never the normal app role.

## 3. Test-only payment provider

`POST /api/billing/stripe-test/checkout` accepts only `{invoiceId}` from the authenticated invoice owner in `stripe_test` mode. The server gets all amounts from the DB, uses idempotency and a hosted Stripe TEST checkout. Only verified provider webhook events create payments. `POST /api/admin/provider/stripe-test/verify` is admin-only and calls the provider using a TEST key. It writes a read-only comparison report and does not silently repair disputes.

Actual Stripe capabilities depend on the merchant account, permitted countries and currency. No test API call was made to a Stripe account here; `stripeFetch` was mocked in tests.

## 4. Email, tax and payout controls

`MAIL_DELIVERY_URL` and `MAIL_DELIVERY_SECRET` optionally route email verification through an approved private HTTPS mail service. Delivery challenges are valid for 30 minutes. Only hashed tokens are stored. The user can record tax residency with `POST /api/compliance/payout/tax` and accept **DRAFT** vendor terms with `POST /api/compliance/payout/terms`. Admins can issue/read/revoke one-time, 15-minute metadata export leases for prepared payout requests. A third independent reviewer is required; revocation is irreversible and a refund invalidates unconsumed leases. No tax ID, passport or bank account is collected here. These are not legally approved payout contracts and no real transfer endpoint exists.

## 5. Recovery, security and deployment gate

`npm run drill:encrypted` makes an in-memory sample R4 encrypted backup, restores and verifies the audit/ledger. `npm run load:smoke` checks 80 concurrent health requests, abuse rate limiting and ledger readiness. `npm run release:gate` intentionally returns a failed CLI status without documented security and live infrastructure evidence. Public TLS, domain, secrets, legal review and offsite copy remain launch blockers. The Compose file is private staging only.
