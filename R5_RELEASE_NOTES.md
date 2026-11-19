# OSMANX PROOF R5 — release notes

**Local integration:** 5/5 R5 code blocks delivered. Verified **218/218** automated tests, **14/14** ephemeral HTTP acceptance checks, **80/80** concurrent `/health` requests, local encrypted restore and integrity checks. The releases R1–R4 are included in the cumulative source archive; no existing production site or GitHub branch was modified.

## 1. Verified customer acceptance becomes delivery work

Project creation requires actual accepted client response tied to the quoted revision; status flag alone is rejected. Project creation is idempotence-guarded by a unique proposal ID and atomic SQL transaction. Organization access uses existing owner/editor/viewer roles.

## 2. Complete milestone + revision workflow

Create, edit with version checks, submit evidence, request revisions, client accept, resubmit and complete; immutable submission hashes, a role-checked org boundary and audit history. This is *workflow evidence*, not independent verification of quality.

## 3. Client-facing approval portal

Time-limited, revocable, stored-as-hash links; consent and exact revision checks; no private cost or email output; XSS escaped HTML. Client identities are self-asserted. Mobile and desktop static Chromium QA screenshots supplied.

## 4. Bilingual application and reports

RU/EN project navigation in the current Node SPA and unbuilt Next.js TSX frontend; project counters, milestones, scoped CSV download, and spreadsheet formula-injection protection. Project values are not accounting revenue.

## 5. Secure staged migration and release checks

Additive SQLite schema and migration export/replay proof; PostgreSQL 006 tenant schemas / 007 RLS smoke (unexecuted on real PostgreSQL); Next.js public proxy route source (syntax-checked only), external CI templates, 14-check HTTP acceptance, 218-test suite, strict production-blocking release gate.

## Important limitations

- **Next.js:** no npm install, typecheck or production build was possible due unavailable npm network.
- **PostgreSQL:** not installed, SQL smoke job did not run; backend still uses SQLite.
- **Browser:** static Chromium render completed; local network navigation blocked, so interactive browser E2E is unverified.
- **Financial:** Stripe TEST provider simulated/stubbed, real billing and payouts disabled.
- **Staging:** no TLS staging deployment, CI run, provider, offsite backup or independent security/legal review.

**Release decision: local R5 build PASS; production readiness BLOCKED.**
