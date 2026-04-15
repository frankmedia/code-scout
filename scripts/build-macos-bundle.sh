#!/usr/bin/env bash
# Release build: frontend + signed .app + DMG (macOS only).
# If DMG fails with "Not enough arguments" from bundle_dmg.sh, ensure CI is unset locally
# and @tauri-apps/cli is current: npm i -D @tauri-apps/cli@latest
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export CI="${CI:-}"
npm run build
npm run tauri:icon
exec npm exec -- tauri build --bundles app,dmg
