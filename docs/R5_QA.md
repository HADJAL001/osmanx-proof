# R5 QA — executed checks and restrictions

## Verified in this runtime

| Check | Result | Scope |
|---|---|---|
| `npm run check` | **PASS 218/218** | Entire R1–R5 Node and SQLite regression suite |
| `npm run acceptance:r5` | **PASS 14/14** | Live local HTTP on ephemeral in-memory SQLite, through quote and stage acceptance |
| `npm run load:smoke` | **PASS 80/80** | Parallel health requests, rate limit + ledger/audit check, NOT production load |
| `npm run drill:encrypted` | **PASS** | AES-256-GCM sample backup + local restore, NOT remote backup |
| Chromium `set_content` screenshot | **PASS** | Desktop 1440 px and mobile 390 px: no horizontal overflow, no console navigation claim |
| Legacy SQLite upgrade and snapshot | **PASS** | New work tables replayed; prior users, quotes, invoices unaffected |
| CSV and browser text protections | **PASS** | Tenant filtering, formula prefixes, public HTML escaping |
| `npm run release:gate` | **BLOCKED as designed** | Returns nonzero without verified external evidence |

## New R5 test modules

- `tests/r5.workflow.test.mjs` — 20 state-machine, tenant, replay, revision and data migration tests.
- `tests/r5.http.test.mjs` — 13 real local HTTP tests: permissions, client link, HTML escaping, content privacy, CSV, statuses.
- `tests/r5.release.test.mjs` — 10 fail-closed release gate policy tests.

These add 43 new tests to the inherited 175, giving **218/218**.

## Not verified (must not be called successful)

1. Next.js full `npm install`, `tsc --noEmit`, `next build`, route execution: npm registry DNS `EAI_AGAIN` and no installed modules; only syntax source parsing.
2. PostgreSQL live migration, FORCE RLS, actual data import or rollback: no server, psql or Docker available.
3. Browser-based live HTTP E2E from Chromium: localhost network navigation blocked with `ERR_BLOCKED_BY_ADMINISTRATOR`. Static render is not equivalent to functional browser E2E.
4. Stripe merchant TEST account requests and signed provider callbacks from an external sandbox: provider methods are mocked in local tests.
5. Real payments, real payouts, independent tax/legal sign-off, email provider, public TLS staging, offsite backup and live CI results.
6. Independent penetration testing, mobile device testing and deployment to any domain.

The feature is useful for **local evaluation only**. The production gate explicitly fails until independent external artifacts and reviewer sign-offs exist.
