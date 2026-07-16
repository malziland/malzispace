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

echo "[1/11] Repo hygiene"
(cd "$ROOT_DIR" && npm run test:repo:hygiene)

echo "[2/11] Lint"
(cd "$ROOT_DIR" && npm run lint)

echo "[3/11] Unit tests + coverage gate"
(cd "$ROOT_DIR" && npm run test:coverage:check)

echo "[4/11] Build hosting bundle"
(cd "$ROOT_DIR" && npm run build:hosting)

echo "[5/11] Start local static server"
python3 -m http.server 4173 --directory "$ROOT_DIR/build/hosting" >/tmp/malzispace-static-server.log 2>&1 &
STATIC_SERVER_PID=$!
sleep 1

echo "[6/11] Frontend simulator E2E"
(cd "$ROOT_DIR" && BASE_URL=http://127.0.0.1:4173 npm run test:e2e:simulator)

echo "[7/11] Frontend toolbar/mobile E2E"
(cd "$ROOT_DIR" && npm run test:e2e:mobile)

echo "[8/11] I18N/legal E2E"
(cd "$ROOT_DIR" && npm run test:e2e:i18n)

echo "[9/11] Accessibility E2E"
(cd "$ROOT_DIR" && npm run test:e2e:a11y)

echo "[10/11] Multiplayer simulator E2E"
(cd "$ROOT_DIR" && npm run test:e2e:multiplayer:sim)

echo "[11/11] Lock-flow E2E (firebase emulator + relay)"
# The lock E2E reuses port 4173 via the firebase hosting emulator, so the
# static server must be stopped before it runs. We restart-free shut it down
# instead of relying on the EXIT trap (which only fires once the whole script
# is done).
if [[ -n "${STATIC_SERVER_PID:-}" ]]; then
  kill "$STATIC_SERVER_PID" >/dev/null 2>&1 || true
  wait "$STATIC_SERVER_PID" 2>/dev/null || true
  STATIC_SERVER_PID=""
fi
(cd "$ROOT_DIR" && npm run test:e2e:lock)

if [[ -n "${APP_CHECK_TOKEN:-}" ]]; then
  echo "[live] Smoke test (live API): running because APP_CHECK_TOKEN is set"
  (cd "$ROOT_DIR" && node tests/live/smoke_test.mjs)
else
  echo "[live] Smoke test (live API): skipped (set APP_CHECK_TOKEN to enable)"
fi

echo "OK"
