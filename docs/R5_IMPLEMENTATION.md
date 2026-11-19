# R5 implementation — durable work workflow

## New workflow entities

R5 appends six `work_*` SQLite tables with foreign keys to existing proposals, organizations and users:

- `work_projects`: one-to-one accepted proposal, accepted response, accepted revision, contract price, status.
- `work_milestones`: ordered stages (max 50/project), version, due date, status.
- `work_submissions`: immutable revision, submitted evidence summary, SHA-256 hash, author.
- `work_client_shares`: hashed bearer link, 30-day expiration, revocation metadata.
- `work_client_responses`: exact submission revision, explicit decision, consent-gated customer statement, unique `(milestone_id,submission_revision)`.

Work is tenant-authorized in `src/workflow.mjs` through `member(actor, org, allowedRoles)`. SQL writes occur inside transactions. Current accepted proposal revision must match a client-accepted version. A manually set `accepted` status is insufficient. Repeated launch fails and cannot duplicate the project.

## State transitions

- `planned/in_progress/changes_requested` -> `submitted` on authorized evidence submission.
- `submitted` -> `accepted` or `changes_requested` by client bearer link holding an unexpired, nonrevoked share token and acknowledging the **latest revision**.
- `changes_requested` -> `submitted` by new evidence revision. Previous responses and hash remain immutable.
- `active project` -> `completed` only when at least one stage exists and *every stage* is accepted. Completed project cannot create more stages.

Stale milestone updates return HTTP 409. Duplicate and stale client acknowledgements return HTTP 409. Unauthorized org reads and mutations return HTTP 403. Raw bearer tokens are not stored; only SHA-256 digests.

## HTTP APIs

Authenticated under `/api/` (cookie session and CSRF token on state changes):

| Route | Action |
|---|---|
| `POST /projects {quoteId}` | start from accepted proposal |
| `GET /projects?orgId=` | scoped summary |
| `GET /projects/:projectId` | full project, milestones and versions |
| `POST /projects/:projectId/milestones` | add stage |
| `PATCH /projects/:projectId/milestones/:milestoneId` | edit before submission, requires expectedVersion |
| `POST /projects/:projectId/milestones/:milestoneId/submit` | submit latest revision |
| `POST /projects/:projectId/share` | issue new client link, revoke older links |
| `POST /projects/:projectId/shares/:shareId/revoke` | revoke a client link |
| `GET /projects/metrics?orgId=` | scoped progress metrics |
| `GET /projects/export.csv?orgId=` | owner/editor CSV with formula neutralization |

Public bearer-link endpoints:

| Route | Action |
|---|---|
| `GET /c/:token` | noindex, no-referrer client HTML |
| `GET /api/public/projects/:token` | limited project data without costs/emails |
| `POST /api/public/projects/:token/milestones/:milestoneId/respond` | accepted/changes_requested, name, message, consent and submissionRevision |

No payments or other financial actions may be triggered through the public link. In the classic UI, project operations are available under Projects / Проекты. In Next.js, public routes are relayed through isolated BFF handlers, not by placing trusted backend credentials into the browser.

## Security boundaries

1. Bearer links give access only to the individual project. A copied link confers the same access, so it is not proof of recipient identity; a real signed contract requires an independently verified process.
2. Tokens are high-entropy, hashed and time-limited. New links revoke previous links. Referrer policy disables token leakage.
3. No cost, email, internal membership or financial ledger fields exist in client-public JSON.
4. HTML is escaped, Origin checked if supplied and per-IP responses rate limited. Public replies are auditable, not signatures.
5. CSV exports filter by organization role. Formula-like prefixes (including after whitespace) get an apostrophe to avoid spreadsheet execution.
6. Project value is labelled *contracted proposal value*, not revenue, earnings or payments.
7. Switching organizations clears selected project on both clients; backend tenant checks remain authoritative.

## PostgreSQL and CI — prepared, NOT runtime migration

`db/postgres/006_workflow.sql` provisions matching schema with FORCE ROW LEVEL SECURITY for project, milestone, submission, share and response tables. Only SELECT on non-secret work views is granted to `proof_app`, and token hashes have no grant. `db/postgres/007_workflow_rls_smoke.sql` checks Alice/Bob and blank actor contexts on a disposable PostgreSQL DB. `deploy/r5-postgres-test.sh` combines the historical schema, policies and new smoke tests. This SQL **has not been executed on PostgreSQL in this environment**. A separate audited read/write persistence adapter and parity-tested cutover are still required.

CI `.github/workflows/ci.yml` defines backend, PostgreSQL, and Next.js jobs. Configuration files are **not proof CI executed**.
