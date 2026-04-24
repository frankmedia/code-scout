#!/usr/bin/env bash
# Build a .tar.gz of Code Scout.app for the in-app updater (updater.rs expects a .app inside the archive).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT/src-tauri/target/release/bundle/macos"
if [[ -d "$APP_DIR/CodeScout.app" ]]; then
  APP_NAME="CodeScout.app"
elif [[ -d "$APP_DIR/Code Scout.app" ]]; then
  APP_NAME="Code Scout.app"
else
  echo "Missing: $APP_DIR/CodeScout.app — run: npm run tauri:build" >&2
  exit 1
fi
VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  VERSION="$(node -p "require('$ROOT/src-tauri/tauri.conf.json').version")"
fi
OUT="$ROOT/public/code-scout/download/Code-Scout_${VERSION}_aarch64.app.tar.gz"
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
( cd "$APP_DIR" && tar czf "$OUT" "$APP_NAME" )
echo "Wrote $OUT"
echo "Tip: npm run publish:mac-downloads copies DMG, refreshes version.json, and can commit/push."
