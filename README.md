# OSMANX PROOF R7 — PARTNER 450 (test prototype)

Latest feature: independent B2B implementation packages, free affiliate status, margin-capped one-tier commissions, buyer acceptance and 450-sale progress. **No real cashout.** See [`docs/R7_PARTNER450_POLICY.md`](docs/R7_PARTNER450_POLICY.md).

# OSMANX PROOF R5 — real-work delivery workflow

**Status:** Runnable local **Node.js 22.16+ / SQLite** product prototype; **218/218** automated tests and **14/14** ephemeral HTTP acceptance checks passed on the development runtime. Next.js and PostgreSQL are supplied as source and migration/CI targets, **not a verified running deployment**. No real charges, transfers or production launch.

## Five integrated R5 blocks

1. **Accepted proposal → delivery project.** A project starts only after a client accepts the latest applicable proposal via its expiring link. Manual changes to the proposal's status are not enough. Multiple launches are blocked. Includes a persistent SQLite workflow schema, tenants and role checks.
2. **Milestones, delivery evidence and revisions.** Owners/editors create milestones (max 50/project), submit immutable descriptions of delivered work, receive client acceptance or a request for changes, and submit a corrected revision. Optimistic version checks prevent accidental overwrites. An audit trail records transitions. A project completes when all milestones are accepted.
3. **Secure customer work portal.** Temporary hashed, revocable, 30-day links at `/c/:token` display only client-facing information. The client explicitly accepts/rejects **a specific submission revision**; stale and duplicate answers are rejected. Internal unit costs and client email are not disclosed. **Link possession is not proof of identity or a legally qualified e-signature.**
4. **RU/EN workspace, team reports and Next.js BFF route source.** New projects navigation in classic web UI and Next.js TSX source, active/completed KPIs, scoped CSV export with spreadsheet-formula injection protection, client response UI and public proxy routes. Proposed project values are explicitly **not recognized revenue**.
5. **Verification and safe deployment path.** R5 PostgreSQL schema/RLS and CI scripts, additive SQLite migration compatibility, isolated local HTTP acceptance, 80-request concurrency smoke, AES-256-GCM backup restore drill, and a **fail-closed** release gate requiring actual external staging evidence.

## Fast start — works locally without installing npm packages

Unpack the ZIP, open a terminal in `osmanx-proof-r5`, and run:

```sh
node --version                 # Node.js 22.16+ recommended
npm run check                 # 218/218 automated tests
npm run acceptance:r5         # 14/14 local HTTP acceptance checks
npm start
```

Open **http://127.0.0.1:3100** in a browser on that machine. The local runtime uses a file-backed SQLite database by default and demo/sandbox payment events only. All credentials should be unique even for local use. For deployment beyond localhost, disable sandbox payments and configure TLS/independent secrets before exposing the service.

## Client workflow

1. Register, create a commercial proposal, then share its protected review link.
2. Client accepts the proposal via that link; it must match the accepted revision.
3. Select **Projects → Start work** / **Проекты → Начать работу** (or start from the accepted proposal).
4. Add milestones and submit the actual result as a description; each version is retained.
5. Copy the temporary client work link; client accepts the delivered milestone or requests changes.
6. Project moves to `completed` once all milestones have a recorded client acceptance.

**Caution:** This portal records responses by whoever has the link. It does not perform identity proofing, create a digital signature or independently verify work. Do not use it as the sole legal acceptance mechanism without counsel.

## Verification & safety

```sh
npm run check
npm run acceptance:r5
npm run load:smoke
npm run drill:encrypted
npm run release:gate       # EXPECTED NON-ZERO until external evidence exists
```

The full user journey is tested against a temporary, in-memory SQLite HTTP server. Two static Chromium screenshots of the HTML portal are provided; **networked Chromium browser E2E is not verified**. A local encrypted restore is tested; **no offsite backup** is configured. PostgreSQL scripts are prepared, but **PostgreSQL server / RLS have not been executed** in this environment. Stripe integration is test-only with stubbed providers; **no real Stripe API has been called**.

## Pending verification on external infrastructure

### Next.js + TypeScript

`web-next/` contains the R5 frontend, public work portal proxy, mobile styling, and pinned package versions. On an Internet-connected CI runner:

```sh
cd web-next
npm install --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run build
```

For a local Next.js development setup, backend `APP_ORIGIN=http://127.0.0.1:3000` and Next `BACKEND_URL=http://127.0.0.1:3100` must be aligned with the same-origin proxy rules. These builds were **not run** in the current offline environment.

### PostgreSQL

On a **disposable** PostgreSQL 16+ database only:

```sh
export DATABASE_URL='postgresql://TEST_USERNAME:TEST_PASSWORD@127.0.0.1:5432/proof_test'
sh deploy/r5-postgres-test.sh
```

The script tests multi-tenant read isolation; SQL migrations **do not** switch the running backend away from SQLite. A full PostgreSQL repository adapter, parallel-run comparison and tested rollback are required before cutover. Never use the PG test script against production.

### Billing / payouts

Sandbox mode creates no live transactions. Stripe TEST checkout is code-path/test-fixture only without merchant keys, external provider verification or published checkout. Payout approvals record policy/compliance state only; **bank payments are not sent**. Do not enable live funds without an approved provider, legal/tax reviews, and independent reconciliation.

## Where to look

- `src/workflow.mjs` — domain rules, revision checks and anti-replay.
- `db/schema.sql` and `db/postgres/006_workflow.sql` — persistence schema.
- `public/client.js`, `public/client.css` — bilingual client portal UI.
- `web-next/components/WorkspaceApp.tsx` — Next.js workspace UI source.
- `tests/r5.workflow.test.mjs`, `tests/r5.http.test.mjs`, `tests/r5.release.test.mjs` — regression tests.
- `scripts/r5-local-acceptance.mjs`, `scripts/r5-release-gate.mjs` — acceptance and launch gate.
- `docs/R5_IMPLEMENTATION.md`, `docs/R5_QA.md`, `docs/R6_PLAN.md` — implementation, evidence, next work.

**Never commit** `.env`, SQLite databases, password or API secrets, encryption keys, or personal-data exports to GitHub.
