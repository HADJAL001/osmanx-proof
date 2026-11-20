#!/bin/sh
set -eu
# Requires disposable PostgreSQL 16/17 and owner-only credentials. Never production.
: "${DATABASE_URL:?Set DATABASE_URL for disposable PostgreSQL test DB}"
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f db/postgres/001_schema.sql
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f db/postgres/002_tenant_rls.sql
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f db/postgres/004_app_role_hardening.sql
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f db/postgres/006_workflow.sql
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f db/postgres/003_rls_smoke.sql
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f db/postgres/005_role_matrix_smoke.sql
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f db/postgres/007_workflow_rls_smoke.sql
# R7 independent B2B sales and tenant isolation.
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f db/postgres/010_partner450.sql
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f db/postgres/011_partner450_rls_smoke.sql
