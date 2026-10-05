#!/bin/bash
# Creates the test database alongside the development one.
#
# The API test suite refuses to run against a database whose name does not end in
# `_test` (see apps/api/src/test/global-setup.ts), so this database is the only
# one the tests can touch.

set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE DATABASE pms_test OWNER $POSTGRES_USER;
EOSQL
