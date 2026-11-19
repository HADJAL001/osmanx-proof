# R5 — five engineering blocks planned, not implemented

1. Get a networked CI runner to complete Next.js install, TypeScript typecheck, production build and real Chromium/mobile E2E (including the public quote acceptance proxy and hosted test checkout).
2. Run a disposable PostgreSQL 16 cluster, apply 001–005 migrations, test every tenant policy and transactional row-content cutover/rollback. Move the real persistence adapter to PostgreSQL only after parity checks.
3. Integrate a merchant-owned Stripe TEST account with hosted checkout, asynchronously created checkout sessions, verified webhook endpoints, verified settlements and refund evidence. No live billing until merchant/legal review.
4. Connect an approved mail provider and legally reviewed identity/tax/payout vendor contracts. Validate consent receipts and privacy retention. Do not transmit personal documents into an unapproved system.
5. Provision real staging TLS, secret manager, versioned offsite encrypted backups, monitored alerts, repeatable load and penetration tests and documented rollback plan. Keep the gate closed until evidence exists.
