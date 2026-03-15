#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
"$ROOT_DIR/tools/bin/assert_repo_root.sh"
cd "$ROOT_DIR"

if [[ -n "$(git status --porcelain=v1)" ]]; then
  echo "Working tree not clean. Commit/stash first." >&2
  exit 1
fi

label_raw="${1:-manual}"
label="$(printf '%s' "$label_raw" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9._-' '-')"
label="${label#-}"
label="${label%-}"
if [[ -z "$label" ]]; then
  label="manual"
fi

tag="restore-$(date '+%Y-%m-%d_%H%M')-${label}"
if git rev-parse --verify --quiet "refs/tags/$tag" >/dev/null; then
  n=2
  while git rev-parse --verify --quiet "refs/tags/${tag}-${n}" >/dev/null; do
    n=$((n + 1))
  done
  tag="${tag}-${n}"
fi

head="$(git rev-parse --short HEAD)"
branch="$(git branch --show-current)"
git tag -a "$tag" -m "restore point: ${label} (${branch} @ ${head})"
echo "$tag"
