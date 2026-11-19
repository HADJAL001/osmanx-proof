# OSMANX PROOF R2 — engineering implementation record

Verified locally on 19 November 2026. The following five scopes contain integrated code, routes, UI, and test coverage. This is **not production**.

## Block 1: customer approval, version locks and audit
- `quote_versions` revision counter; each edit resets status to `draft` and atomically revokes open shares.
- `quote_share_versions` stores SHA-256 of externally visible commercial terms; a subsequent version invalidates older URLs.
- `quote_responses` records an explicit customer response, consent, responder-provided name and hashed request-source IP; response is one-time per share.
- UI delivered at `/s/:token` with accept/change request actions. User dashboard displays response history and distinguishes manual acceptance from client response.
- Public quote view excludes supplier cost fields, margin and customer email. The quote client is not independently identity-verified.

## Block 2: explicit subscription lifecycle
- `subscription_preferences` stores `manual`/`stopped` state, cancellation and resumption timestamps.
- `invoice_voids` invalidates unpaid invoices atomically. A later signed payment event cannot settle a voided invoice.
- Paid Pro access is retained to existing `active_until`; there is **no recurring debit**. Resume is permission to manually buy a new month, not auto-charge.
- UI has a stop/resume control for workspace owners.

## Block 3: statement reconciliation
- `settlement_reports` stores digest, unique provider report ID and discrepancy summary.
- Compares external payment identifiers, charged amounts and refunds to local records. `complete=true` means full historical provider report, not a period-specific excerpt.
- Same report ID + same content is idempotent. Different content with same ID is rejected.
- Does **not** move any ledger balances, approve payouts, or prove the authenticity of a manually supplied report.

## Block 4: anti-fraud hold and payout safety
- Shared workspace, shared signup network and clusters of four-or-more accounts generate manual review flags.
- Admin can recheck previously registered users; existing signals deduplicate.
- Newly discovered fraud demotes released-but-unpaid rewards back to `pending`, rejects unsupported reserved payout requests.
- Confirmed abuse blocks new reward generation and release. Payment for an actual software subscription is not automatically denied.
- `TRUSTED_PROXY_IPS` is an allowlist for IP extraction through reverse proxies. Unknown client headers are ignored.

## Block 5: data recovery and staging-readiness checks
- SQLite online backup through Node's built-in `backup()` API; restoration is create-only.
- Explicit check of database integrity, foreign keys, audit chain and debit/credit balances.
- SHA-256 manifest generated and verified. The manifest is **not signed**, so integrity is not independently authenticated.
- `GET /ready` returns HTTP 503 if DB or ledger/audit integrity checks fail.
- Staging Dockerfile, staging compose and GitHub Actions checks. Containers not executed in local environment.

## Upgrade notes
- Existing R1 DBs are upgraded through new `CREATE TABLE IF NOT EXISTS` statements; no destructive rename or reset.
- Previously issued R1 share URLs lack version evidence and are invalidated by design; owners generate a new share URL.
- Full commercial deployment requires migration to PostgreSQL/Next.js, licensed/appropriate merchant provider, legal review and production operations. The original (more ambitious) R2 plan is preserved as `R2_ORIGINAL_PLAN.md` for traceability, not asserted complete.
