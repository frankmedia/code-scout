#!/usr/bin/env bash
# Copy release DMG + build updater tarball, refresh version.json, optionally commit/push.
# The macOS app checks GitHub releases/latest (see src-tauri/src/updater.rs); llmscout.co
# mirrors under /code-scout/download/ when you use --sync-to.
#
# Prerequisites: npm run tauri:build:mac or bash scripts/build-macos-bundle.sh (signed .app + DMG).
#
# Usage:
#   bash scripts/publish-mac-downloads.sh
#   bash scripts/publish-mac-downloads.sh --sync-to /path/to/llm-scout
#   bash scripts/publish-mac-downloads.sh --commit
#   bash scripts/publish-mac-downloads.sh --push
#   bash scripts/publish-mac-downloads.sh --sync-to ~/llm-scout --site-commit -m "chore: mac downloads"
#   bash scripts/publish-mac-downloads.sh --sync-to ~/llm-scout --site-push
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f "$ROOT/src-tauri/tauri.conf.json" ]]; then
  echo "This script must run from the Code Scout (Tauri) repo root (missing src-tauri/tauri.conf.json)." >&2
  exit 1
fi

DOWNLOAD_DIR="public/code-scout/download"
BASE_URL="https://llmscout.co/code-scout/download"

COMMIT=0
PUSH=0
NOTES=""
COMMIT_MSG=""
SYNC_TO=""
SITE_COMMIT=0
SITE_PUSH=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --commit) COMMIT=1; shift ;;
    --push)
      COMMIT=1
      PUSH=1
      shift
      ;;
    --sync-to)
      SYNC_TO="$(cd "${2:?}" && pwd)"
      shift 2
      ;;
    --site-commit) SITE_COMMIT=1; shift ;;
    --site-push)
      SITE_COMMIT=1
      SITE_PUSH=1
      shift
      ;;
    --notes)
      NOTES="${2-}"
      shift 2
      ;;
    -m|--message)
      COMMIT_MSG="${2-}"
      shift 2
      ;;
    -h|--help)
      sed -n '1,28p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $1 (try --help)" >&2
      exit 1
      ;;
  esac
done

if [[ "$SITE_COMMIT" -eq 1 || "$SITE_PUSH" -eq 1 ]]; then
  if [[ -z "$SYNC_TO" ]]; then
    echo "--site-commit / --site-push require --sync-to <llm-scout-repo-root>" >&2
    exit 1
  fi
fi

VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
DMG_DIR="$ROOT/src-tauri/target/release/bundle/dmg"
shopt -s nullglob
DMGS=( "$DMG_DIR"/*.dmg )
shopt -u nullglob

if [[ ${#DMGS[@]} -eq 0 ]]; then
  echo "No .dmg in $DMG_DIR." >&2
  echo "Build: npm run tauri:build:mac  (or: bash scripts/build-macos-bundle.sh)" >&2
  echo "DMG troubleshooting: unset CI if it is set to true; upgrade CLI: npm i -D @tauri-apps/cli@latest" >&2
  echo "App-only fallback: npm run tauri:build:app  → bundle/macos/*.app" >&2
  exit 1
fi

DMG="$(ls -t "$DMG_DIR"/*.dmg | head -n 1)"
BASENAME="$(basename "$DMG")"
TAR_NAME="Code-Scout_${VERSION}_aarch64.app.tar.gz"

mkdir -p "$ROOT/$DOWNLOAD_DIR"
cp "$DMG" "$ROOT/$DOWNLOAD_DIR/$BASENAME"
echo "Copied DMG → $DOWNLOAD_DIR/$BASENAME"

bash "$ROOT/scripts/pack-mac-updater-artifact.sh" "$VERSION"

export ROOT VERSION NOTES BASE_URL TAR_NAME DOWNLOAD_DIR
node <<'NODE'
const fs = require("fs");
const path = require("path");
const version = process.env.VERSION;
const notes = process.env.NOTES ?? "";
const url = `${process.env.BASE_URL}/${process.env.TAR_NAME}`;
const doc = { version, url, notes };
const outPath = path.join(process.env.ROOT, process.env.DOWNLOAD_DIR, "version.json");
fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n");
NODE
echo "Wrote $DOWNLOAD_DIR/version.json (v${VERSION})"

if [[ -n "$SYNC_TO" ]]; then
  DEST="$SYNC_TO/$DOWNLOAD_DIR"
  mkdir -p "$DEST"
  rsync -a --delete "$ROOT/$DOWNLOAD_DIR/" "$DEST/"
  echo "Synced → $DEST (llm-scout)"
fi

if [[ "$COMMIT" -eq 0 && "$SITE_COMMIT" -eq 0 ]]; then
  echo "Done. Use --commit / --push for this repo, or --sync-to <llm-scout> [--site-commit|--site-push] for the site repo."
  exit 0
fi

remove_git_lock() {
  local repo="$1"
  for f in "$repo/.git/index.lock" "$repo/.git/shallow.lock"; do
    if [[ -f "$f" ]]; then
      echo "Removing stale lock: $f (ensure no other git is using this repo)" >&2
      rm -f "$f"
    fi
  done
}

if [[ "$COMMIT" -eq 1 ]]; then
  [[ -n "$COMMIT_MSG" ]] || COMMIT_MSG="chore(release): mac downloads v${VERSION}"
  remove_git_lock "$ROOT"
  git add "$DOWNLOAD_DIR/version.json"
  git add vercel.json 2>/dev/null || true
  git add src/App.tsx src/pages/CodeScoutDownload.tsx 2>/dev/null || true
  git add src-tauri/src/updater.rs 2>/dev/null || true
  git add -f "$DOWNLOAD_DIR/$BASENAME"
  git add -f "$DOWNLOAD_DIR/$TAR_NAME"
  if git diff --staged --quiet; then
    echo "Nothing staged to commit in code-scout."
  else
    git commit -m "$COMMIT_MSG"
  fi
  if [[ "$PUSH" -eq 1 ]]; then
    git push
    echo "Pushed code-scout."
  fi
fi

if [[ "$SITE_COMMIT" -eq 1 ]]; then
  [[ -n "$SYNC_TO" ]] || { echo "Internal: SYNC_TO required"; exit 1; }
  remove_git_lock "$SYNC_TO"
  SITE_MSG="${COMMIT_MSG:-chore(release): Code Scout mac downloads v${VERSION}}"
  (
    cd "$SYNC_TO"
    git add public/code-scout/download/version.json vercel.json .gitignore 2>/dev/null || true
    git add app/code-scout/download/page.tsx app/code-scout/download/layout.tsx 2>/dev/null || true
    git add app/code-scout/page.tsx 2>/dev/null || true
    git add -f public/code-scout/download/"$BASENAME" 2>/dev/null || true
    git add -f "public/code-scout/download/$TAR_NAME" 2>/dev/null || true
    if git diff --staged --quiet; then
      echo "Nothing staged to commit in llm-scout."
    else
      git commit -m "$SITE_MSG"
    fi
  )
  if [[ "$SITE_PUSH" -eq 1 ]]; then
    ( cd "$SYNC_TO" && git push )
    echo "Pushed llm-scout — Vercel deploy should pick up /code-scout/download."
  fi
fi
