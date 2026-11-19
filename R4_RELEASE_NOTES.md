# OSMANX PROOF R4 — five implementation blocks

R4 is a **local source-and-test release**, not a deployed product. The original SQLite backend continues working; the Next.js and PostgreSQL sources require a dependency-equipped environment and a live Postgres service for their acceptance.

1. **Next.js user flows and BFF**: secure authenticated path allowlist; client proposal acceptance POST proxy; standalone print/review asset routes; Stripe TEST hosted checkout link; tax declaration and draft vendor consent UI. The checkout URL is restricted to `checkout.stripe.com`. **Next build and Chromium network E2E were blocked in this environment**; TS/TSX parsing and pure TypeScript finance execution were verified.
2. **PostgreSQL cutover security**: exact exported table/column inventory checks; transactional row-by-row field verification with rollback on mismatch (not just counts); an application NOLOGIN role with least privilege, forced RLS and INSERT/UPDATE/DELETE quote policy split. The live PostgreSQL migration and SQL role matrix are committed as a CI job, **not executed locally**.
3. **Stripe test checkout/reconciliation**: Stripe-hosted test checkout session, required local session or intent binding before ledger credit, signed checkout-completion webhooks, duplicate/refund idempotence, independent read-only provider settlement comparison with recorded evidence. Credentials are test-only; no real payment acceptance.
4. **Compliance exports and email**: optional signed outbound challenge transport with no token exposure in HTTP responses; self-declared tax country/type, draft payout terms, third-independent-admin one-use export leases, permanent revocation and refund invalidation. No KYC vendor, tax verification or bank payout is connected.
5. **Encrypted recovery and staging protection**: AES-256-GCM authenticated backup/restore, fail-closed staging gate, rate-limit and concurrency tests, hardened Docker/CI configs and disposable PostgreSQL policy test script. No cloud/offsite destination is connected and no penetration test is certified.

See `docs/R4_IMPLEMENTATION.md` and `docs/R4_QA.md` for tests and limitations.

**Final local regression: 175/175 Node tests.** Historic R3 SQLite data and quote approval token compatibility verified. This count is NOT a production-readiness percentage.
