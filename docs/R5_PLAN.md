# R5 completed-scope plan, with deviations from original plan

The R4 roadmap targeted five external verification objectives: (1) installed Next.js build and networked browser E2E; (2) live disposable PostgreSQL RLS and transactional cutover; (3) real merchant-owned Stripe TEST environment; (4) real mail/identity/tax vendors; (5) TLS staging. **The environment had none of the external dependencies required to demonstrate those results.** Therefore no completion was claimed on those infrastructure objectives.

To deliver a real usable R5 release in this pass, five self-contained locally verifiable blocks were implemented:

1. Client-accepted quote to durable work project (server, schema, tests).
2. Milestones, revisions, delivered work evidence, client responses and completion (server, schema, tests).
3. Time-limited revocable client portal, restricted fields, explicit consent, duplicate protection (server, web assets, tests).
4. RU/EN workspaces, scoped reports and CSV, Next.js BFF route source and PostgreSQL migration/RLS script additions (frontends/SQL/tests).
5. Reproducible HTTP acceptance, staging fail-closed gate, 80-request smoke, encrypted restore and independent ZIP verification (scripts/QA).

Remaining external infrastructure verification objectives have been transferred to `docs/R6_PLAN.md`. Read `docs/R5_ORIGINAL_PLAN.md` to see the full earlier roadmap and compare it with what was actually executed.
