#!/usr/bin/env bash
# Full release pipeline: notarized build → GitHub Release → website sync.
#
# Usage:
#   bash scripts/release-mac.sh
#   bash scripts/release-mac.sh --bump              # bump 0.1.0→0.1.1 (see scripts/bump-app-version.mjs), then build & release
#   bash scripts/release-mac.sh --notes "Bug fixes and performance improvements"
#   bash scripts/release-mac.sh --skip-build          # reuse last build, just release
#   bash scripts/release-mac.sh --sync-to ~/llm-scout # also sync to website repo
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NOTES=""
SKIP_BUILD=0
BUMP_VERSION=0
SYNC_TO=""
EXTRA_PUBLISH_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bump)        BUMP_VERSION=1; shift ;;
    --notes)       NOTES="${2:?}"; shift 2 ;;
    --skip-build)  SKIP_BUILD=1; shift ;;
    --sync-to)     SYNC_TO="${2:?}"; shift 2 ;;
    --site-commit) EXTRA_PUBLISH_ARGS+=("--site-commit"); shift ;;
    --site-push)   EXTRA_PUBLISH_ARGS+=("--site-commit" "--site-push"); shift ;;
    -h|--help)
      sed -n '1,14p' "$0"
      exit 0
      ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 1 ;;
  esac
done

if [[ "$BUMP_VERSION" -eq 1 ]]; then
  node "$ROOT/scripts/bump-app-version.mjs"
fi

if [[ "$BUMP_VERSION" -eq 1 && "$SKIP_BUILD" -eq 1 ]]; then
  echo "Warning: --bump with --skip-build — bundle files may not match the new version; rebuild unless you know the artifacts are correct." >&2
fi

VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
TAG="v${VERSION}"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  Code Scout — release pipeline           ║"
echo "║  Version : ${VERSION}                          ║"
echo "║  Tag     : ${TAG}                         ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 1. Build (sign + notarize) ────────────────────────────────────────────────
if [[ "$SKIP_BUILD" -eq 0 ]]; then
  echo "Step 1/3 — Building signed + notarized…"
  bash "$ROOT/scripts/build-signed-notarized.sh"
else
  echo "Step 1/3 — Skipped (--skip-build)"
fi

# ── 2. Locate DMG ─────────────────────────────────────────────────────────────
DMG_DIR="$ROOT/src-tauri/target/release/bundle/dmg"
shopt -s nullglob
DMGS=( "$DMG_DIR"/*.dmg )
shopt -u nullglob

if [[ ${#DMGS[@]} -eq 0 ]]; then
  echo "No .dmg found in $DMG_DIR — build first." >&2
  exit 1
fi

DMG="$(ls -t "$DMG_DIR"/*.dmg | head -n 1)"
DMG_NAME="$(basename "$DMG")"
echo ""
echo "DMG: $DMG_NAME"

echo ""
echo "Packing in-app updater archive (.app.tar.gz) for GitHub + updater.rs…"
bash "$ROOT/scripts/pack-mac-updater-artifact.sh" "$VERSION"
TAR_NAME="Code-Scout_${VERSION}_aarch64.app.tar.gz"
TAR="$ROOT/public/code-scout/download/$TAR_NAME"
if [[ ! -f "$TAR" ]]; then
  echo "Expected updater tarball missing: $TAR" >&2
  exit 1
fi

# ── 3. GitHub Release ─────────────────────────────────────────────────────────
echo ""
echo "Step 2/3 — Creating GitHub Release ${TAG}…"

if gh release view "$TAG" &>/dev/null; then
  echo "Release ${TAG} already exists — uploading assets to existing release."
  gh release upload "$TAG" "$DMG" "$TAR" --clobber
else
  RELEASE_TITLE="Code Scout ${VERSION} (macOS beta)"
  RELEASE_BODY="$(cat <<EOF
## Code Scout ${VERSION}

${NOTES:-Signed, notarized, and stapled macOS build (Apple Silicon).}

### Download

| File | Arch | Note |
|------|------|------|
| \`${DMG_NAME}\` | Apple Silicon (aarch64) | Notarized — opens without Gatekeeper warnings |
| \`${TAR_NAME}\` | Apple Silicon (aarch64) | In-app updater (\`.app.tar.gz\`) — used by **Check for updates** |

### Install

1. Open the DMG
2. Drag **Code Scout** into **Applications**
3. Launch from Applications (no right-click workaround needed)

Releases: https://github.com/frankmedia/code-scout/releases
EOF
)"

  gh release create "$TAG" "$DMG" "$TAR" \
    --title "$RELEASE_TITLE" \
    --notes "$RELEASE_BODY" \
    --latest
fi

RELEASE_URL="$(gh release view "$TAG" --json url -q .url)"
echo ""
echo "GitHub Release: $RELEASE_URL"

# ── 4. Website sync ───────────────────────────────────────────────────────────
echo ""
echo "Step 3/3 — Syncing to website downloads…"

PUBLISH_ARGS=()
[[ -n "$NOTES" ]] && PUBLISH_ARGS+=(--notes "$NOTES")
[[ -n "$SYNC_TO" ]] && PUBLISH_ARGS+=(--sync-to "$SYNC_TO")
PUBLISH_ARGS+=("${EXTRA_PUBLISH_ARGS[@]+"${EXTRA_PUBLISH_ARGS[@]}"}")

bash "$ROOT/scripts/publish-mac-downloads.sh" "${PUBLISH_ARGS[@]+"${PUBLISH_ARGS[@]}"}"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  Release complete                         ║"
echo "╠══════════════════════════════════════════╣"
echo "║  GitHub : ${RELEASE_URL}"
echo "║  DMG    : ${DMG_NAME}"
echo "║  Updater: ${TAR_NAME}"
echo "╚══════════════════════════════════════════╝"
