#!/usr/bin/env bash
# One-shot: sync semver everywhere + version.json + refresh Cargo.lock for the app crate.
#
# Usage:
#   bash scripts/release-version.sh              # patch bump (reads current tauri.conf.json)
#   bash scripts/release-version.sh 0.1.20       # exact version
#   bash scripts/release-version.sh --set 0.1.20 # same
#   bash scripts/release-version.sh --no-cargo   # skip cargo lock refresh (not recommended)
#
# Env:
#   CS_RELEASE_REPO=owner/repo   — GitHub path for version.json URL (default: frankmedia/code-scout)
#
# Then run the printed git commands (npm run release:version).
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

usage() {
  sed -n '1,22p' "$0" >&2
  exit 1
}

NO_CARGO=0
FORWARD=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage ;;
    --no-cargo) NO_CARGO=1; shift ;;
    *) FORWARD+=("$1"); shift ;;
  esac
done

echo "→ Writing version files (Node)…"
node "$ROOT/scripts/bump-app-version.mjs" "${FORWARD[@]+"${FORWARD[@]}"}"

if [[ "$NO_CARGO" -eq 0 ]]; then
  echo "→ cargo update -p app (Cargo.lock)…"
  (cd "$ROOT/src-tauri" && cargo update -p app)
else
  echo "→ skipped cargo update (-p app) because of --no-cargo"
fi

VER="$(cd "$ROOT" && node -p "require('./package.json').version")"

# GitHub owner/repo for links (override with CS_RELEASE_REPO=owner/name).
GH_REPO="${CS_RELEASE_REPO:-}"
if [[ -z "$GH_REPO" ]]; then
  _origin="$(git -C "$ROOT" remote get-url origin 2>/dev/null || true)"
  if [[ "$_origin" =~ github\.com[:/]([^/]+/[^/.]+)(\.git)?$ ]]; then
    GH_REPO="${BASH_REMATCH[1]}"
  fi
fi
[[ -z "$GH_REPO" ]] && GH_REPO="frankmedia/code-scout"
TAG="v${VER}"
WORKFLOW_URL="https://github.com/${GH_REPO}/actions/workflows/release.yml"

echo ""
echo "✓ Repo is aligned on version ${VER}"
echo ""
echo "Next (in order). Release only starts after you push the tag — not after main alone:"
echo ""
echo "  git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock public/code-scout/download/version.json"
echo "  git commit -m \"chore: release v${VER}\""
echo "  git push origin main"
echo "  git tag -a \"${TAG}\" -m \"${TAG}\""
echo "  git push origin \"${TAG}\""
echo ""
echo "  ${WORKFLOW_URL}"
echo ""
