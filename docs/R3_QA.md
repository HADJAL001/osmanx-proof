# R3 verification (2026-11-19)

**Local node tests:** 126 of 126 passed; full R1/R2 regression retained.

Test groups:
- Previous R1/R2: 73 tests
- Native Stripe test adapter: 15 tests
- Sensitive export / SQLite replay / PG policy static smoke: 8 tests
- Consent, identity, payout preparation and refund revocation: 13 tests
- Metrics, preflight, recovery and source asset sanity: 10 tests
- R3 HTTP authorization and compliance: 7 tests

**Executed in this environment:** `npm run check`, several repeated `npm test` suites, global TypeScript 5.8.3 `tsc --noEmit` on dependency-free frontend libraries, TypeScript parse of `.ts/.tsx`, SQLite export and recovery drill, HTTP integration through localhost.

**Not executed:** `npm install`/`next build` (`registry.npmjs.org` DNS unavailable), PostgreSQL SQL application (`psql` absent), Docker startup (`docker` absent), GitHub Actions job (no new repo), real TLS reverse proxy, Stripe network API with merchant test credentials, mobile-device E2E, independent penetration testing.

The GitHub workflow describes *future* checks; its existence is not a CI success assertion. User-visible screenshots in `qa/` are retained R2 visual checks, not verified Next.js screenshots.
