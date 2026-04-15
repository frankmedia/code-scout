#!/usr/bin/env bash
# Build a .tar.gz of Code Scout.app for the in-app updater (updater.rs expects a .app inside the archive).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/src-tauri/target/release/bundle/macos/Code Scout.app"
VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  VERSION="$(node -p "require('$ROOT/src-tauri/tauri.conf.json').version")"
fi
OUT="$ROOT/public/code-scout/download/Code-Scout_${VERSION}_aarch64.app.tar.gz"
if [[ ! -d "$APP" ]]; then
  echo "Missing: $APP — run: npm run tauri:build" >&2
  exit 1
fi
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
( cd "$(dirname "$APP")" && tar czf "$OUT" "Code Scout.app" )
echo "Wrote $OUT"
echo "Tip: npm run publish:mac-downloads copies DMG, refreshes version.json, and can commit/push."
