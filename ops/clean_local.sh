#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
"$ROOT_DIR/tools/bin/assert_repo_root.sh"
cd "$ROOT_DIR"

echo "Deleting OS junk (.DS_Store)..."
find . -name .DS_Store -type f -print -delete || true

echo "Deleting Firebase local cache (.firebase)..."
rm -rf .firebase || true

echo "Deleting generated hosting build (build/)..."
rm -rf build || true

echo "Deleting Node.js install artifacts (node_modules)..."
rm -rf node_modules tests/node_modules services/api/node_modules services/collab-relay/node_modules || true

echo "OK"
