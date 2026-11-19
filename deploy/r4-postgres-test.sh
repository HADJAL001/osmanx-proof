#!/bin/sh
set -eu
# Run inside controlled disposable PostgreSQL 16 staging, never production.
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f db/postgres/001_schema.sql
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f db/postgres/002_tenant_rls.sql
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f db/postgres/004_app_role_hardening.sql
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f db/postgres/003_rls_smoke.sql
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f db/postgres/005_role_matrix_smoke.sql
