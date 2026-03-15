#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
"$ROOT_DIR/tools/bin/assert_repo_root.sh"

cleanup() {
  if [[ -n "${STATIC_SERVER_PID:-}" ]]; then
    kill "$STATIC_SERVER_PID" >/dev/null 2>&1 || true
    wait "$STATIC_SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "[1/9] Repo hygiene"
(cd "$ROOT_DIR" && npm run test:repo:hygiene)

echo "[2/9] Lint"
(cd "$ROOT_DIR" && npm run lint)

echo "[3/9] Unit tests + coverage gate"
(cd "$ROOT_DIR" && npm run test:coverage:check)

echo "[4/9] Build hosting bundle"
(cd "$ROOT_DIR" && npm run build:hosting)

echo "[5/9] Start local static server"
python3 -m http.server 4173 --directory "$ROOT_DIR/build/hosting" >/tmp/malzispace-static-server.log 2>&1 &
STATIC_SERVER_PID=$!
sleep 1

echo "[6/9] Frontend simulator E2E"
(cd "$ROOT_DIR" && BASE_URL=http://127.0.0.1:4173 npm run test:e2e:simulator)

echo "[7/9] Frontend toolbar/mobile E2E"
(cd "$ROOT_DIR" && npm run test:e2e:mobile)

echo "[8/9] I18N/legal E2E"
(cd "$ROOT_DIR" && npm run test:e2e:i18n)

echo "[9/9] Multiplayer simulator E2E"
(cd "$ROOT_DIR" && npm run test:e2e:multiplayer:sim)

if [[ -n "${APP_CHECK_TOKEN:-}" ]]; then
  echo "[live] Smoke test (live API): running because APP_CHECK_TOKEN is set"
  (cd "$ROOT_DIR" && node tests/live/smoke_test.mjs)
else
  echo "[live] Smoke test (live API): skipped (set APP_CHECK_TOKEN to enable)"
fi

echo "OK"
