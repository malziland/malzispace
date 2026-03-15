#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
"$ROOT_DIR/tools/bin/assert_repo_root.sh"

BASE_URL="${BASE_URL:-https://malzispace.web.app}"
ENGINES="${ENGINES:-chromium}"

echo "[1/2] Live smoke test (temporary App Check debug token)"
(cd "$ROOT_DIR" && BASE_URL="$BASE_URL" node tests/live/run_smoke_with_temp_debug_token.mjs)

echo "[2/2] Live multiplayer test (temporary App Check debug token)"
(cd "$ROOT_DIR" && BASE_URL="$BASE_URL" ENGINES="$ENGINES" node tests/e2e/run_multiplayer_checks.mjs)

echo "LIVE OK"
