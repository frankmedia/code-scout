#!/usr/bin/env bash
# Full release pipeline: bump version → notarized build → GitHub Release → update website → push everything.
#
# ALWAYS produces signed + notarized macOS builds. Never uses CI for macOS distribution.
#
# Usage:
#   npm run release:version                     # patch bump (0.1.30 → 0.1.31)
#   npm run release:version -- 0.2.0            # exact version
#   npm run release:version -- --set 0.2.0      # same
#   npm run release:version -- --skip-build     # reuse last build artifacts
#   npm run release:version -- --notes "Fixed web navigation bug"
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LLM_SCOUT_DIR="${LLM_SCOUT_DIR:-/Users/frank/llm-scout}"

SKIP_BUILD=0
NOTES=""
FORWARD=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      sed -n '1,14p' "$0" >&2
      exit 0
      ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --notes)      NOTES="${2:?--notes requires a value}"; shift 2 ;;
    *)            FORWARD+=("$1"); shift ;;
  esac
done

# ── 1. Bump version ──────────────────────────────────────────────────────────
echo ""
echo "┌──────────────────────────────────────────┐"
echo "│  Step 1/5 — Bump version                 │"
echo "└──────────────────────────────────────────┘"
node "$ROOT/scripts/bump-app-version.mjs" "${FORWARD[@]+"${FORWARD[@]}"}"

echo "→ cargo update -p app (Cargo.lock)…"
(cd "$ROOT/src-tauri" && cargo update -p app)

VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"

echo ""
echo "  Version : ${VERSION}"
echo "  Tag     : ${TAG}"
echo ""

# ── 2. Commit + push version bump ────────────────────────────────────────────
echo "┌──────────────────────────────────────────┐"
echo "│  Step 2/5 — Commit version bump          │"
echo "└──────────────────────────────────────────┘"
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock public/code-scout/download/version.json
if git diff --staged --quiet; then
  echo "Version files already committed."
else
  git commit -m "chore: release v${VERSION}"
fi
git push origin main
echo "Pushed version bump to main."

# ── 3. Notarized build ───────────────────────────────────────────────────────
echo ""
echo "┌──────────────────────────────────────────┐"
echo "│  Step 3/5 — Signed + notarized build     │"
echo "└──────────────────────────────────────────┘"
if [[ "$SKIP_BUILD" -eq 0 ]]; then
  bash "$ROOT/scripts/build-signed-notarized.sh"
else
  echo "Skipped (--skip-build). Reusing existing artifacts."
fi

# ── 4. GitHub Release ─────────────────────────────────────────────────────────
echo ""
echo "┌──────────────────────────────────────────┐"
echo "│  Step 4/5 — GitHub Release               │"
echo "└──────────────────────────────────────────┘"

DMG_DIR="$ROOT/src-tauri/target/release/bundle/dmg"
APP_DIR="$ROOT/src-tauri/target/release/bundle/macos"

DMG="$(ls -t "$DMG_DIR"/*.dmg 2>/dev/null | head -n 1 || true)"
if [[ -z "$DMG" ]]; then
  echo "No DMG found in $DMG_DIR — cannot create release." >&2
  exit 1
fi

ZIP="/tmp/CodeScout-aarch64-apple-darwin.zip"
if [[ -d "$APP_DIR/CodeScout.app" ]]; then
  echo "Creating notarized zip from .app…"
  ditto -c -k --keepParent "$APP_DIR/CodeScout.app" "$ZIP"
elif [[ -d "$APP_DIR/Code Scout.app" ]]; then
  echo "Creating notarized zip from .app…"
  ditto -c -k --keepParent "$APP_DIR/Code Scout.app" "$ZIP"
fi

bash "$ROOT/scripts/pack-mac-updater-artifact.sh" "$VERSION"
TAR="$ROOT/public/code-scout/download/Code-Scout_${VERSION}_aarch64.app.tar.gz"

ASSETS=("$DMG")
[[ -f "$ZIP" ]] && ASSETS+=("$ZIP")
[[ -f "$TAR" ]] && ASSETS+=("$TAR")

RELEASE_NOTES="${NOTES:-Signed, notarized, and stapled macOS build (Apple Silicon). Opens without Gatekeeper warnings.}"

if gh release view "$TAG" &>/dev/null; then
  echo "Release ${TAG} exists — uploading assets."
  gh release upload "$TAG" "${ASSETS[@]}" --clobber
else
  gh release create "$TAG" "${ASSETS[@]}" \
    --title "Code Scout v${VERSION}" \
    --notes "$RELEASE_NOTES" \
    --latest
fi

RELEASE_URL="$(gh release view "$TAG" --json url -q .url)"
echo "GitHub Release: $RELEASE_URL"

# ── 5. Update llmscout.co download page ──────────────────────────────────────
echo ""
echo "┌──────────────────────────────────────────┐"
echo "│  Step 5/5 — Update website downloads     │"
echo "└──────────────────────────────────────────┘"

DOWNLOADS_FILE="$LLM_SCOUT_DIR/app/code-scout/CodeScoutDownloads.tsx"
if [[ -f "$DOWNLOADS_FILE" ]]; then
  sed -i '' "s/const V = '[^']*';/const V = '${VERSION}';/" "$DOWNLOADS_FILE"
  echo "Updated CodeScoutDownloads.tsx → v${VERSION}"

  (
    cd "$LLM_SCOUT_DIR"
    git add app/code-scout/CodeScoutDownloads.tsx
    if git diff --staged --quiet; then
      echo "Website already up to date."
    else
      git commit -m "Bump Code Scout downloads to v${VERSION}"
      git push
      echo "Pushed llmscout.co update — Vercel will auto-deploy."
    fi
  )
else
  echo "Warning: $DOWNLOADS_FILE not found — update the website manually." >&2
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  Release v${VERSION} complete              "
echo "╠══════════════════════════════════════════╣"
echo "║  GitHub  : ${RELEASE_URL}"
echo "║  Website : https://llmscout.co/code-scout"
echo "║  DMG     : $(basename "$DMG")"
echo "╚══════════════════════════════════════════╝"
