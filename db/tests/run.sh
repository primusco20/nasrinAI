#!/usr/bin/env bash
# Runs the migration twice (it must be repeatable) and then the checks, on a
# scratch database. Needs a local PostgreSQL 15+ you can reach with psql.
#   PGHOST=/tmp PGPORT=5499 PGUSER=postgres db/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="nasrinai_test_$$"
createdb "$DB"
trap 'dropdb --if-exists "$DB"' EXIT
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f db/tests/supabase-roles.sql
for f in db/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"
done
for t in db/tests/*.test.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$t"
done
