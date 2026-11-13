#!/bin/sh
# Runs the scripted scenario against a running legacy-shop.
#
#   ./scenario.sh             run the 27 requests and check the responses
#   ./scenario.sh --verify    also compare what the database received with
#                             expected.yaml (needs the Compose stack from this
#                             directory, because it reads the db service's log)
#
# BASE_URL selects the target (default http://localhost:3000). Point it at
# Legacy Checker's HTTP port to send the scenario through the recorder.
# The database must be freshly seeded: docker compose down -v, then up.
set -eu

cd "$(dirname "$0")"
BASE_URL="${BASE_URL:-http://localhost:3000}"

if [ ! -d scenario/node_modules ]; then
    (cd scenario && npm ci --no-audit --no-fund >/dev/null)
fi

if [ "${1:-}" = "--verify" ]; then
    exec node scenario/verify-expected.mjs --base-url "$BASE_URL" \
        --log-cmd "docker compose logs --no-log-prefix db"
fi

exec node scenario/scenario.mjs --base-url "$BASE_URL" "$@"
