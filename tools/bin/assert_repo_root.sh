#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GIT_TOPLEVEL="$(git -C "$ROOT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"

if [[ -z "$GIT_TOPLEVEL" ]]; then
  echo "Not a git repository: $ROOT_DIR" >&2
  exit 1
fi

if [[ "$GIT_TOPLEVEL" != "$ROOT_DIR" ]]; then
  echo "Unexpected git toplevel: $GIT_TOPLEVEL" >&2
  echo "Expected: $ROOT_DIR" >&2
  exit 1
fi

if [[ -d "$ROOT_DIR/../.git" ]]; then
  echo "Warning: parent directory also contains .git ($ROOT_DIR/../.git)." >&2
  echo "Use only this repository root: $ROOT_DIR" >&2
fi
