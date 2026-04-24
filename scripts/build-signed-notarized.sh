#!/usr/bin/env bash
# Build, sign, notarize, and staple Code Scout for macOS distribution.
#
# Prerequisites:
#   1. Developer ID Application certificate in your keychain
#   2. App Store Connect API key — set these env vars (or source .env.notarize):
#        APPLE_API_KEY          Key ID from App Store Connect
#        APPLE_API_ISSUER       Issuer ID from App Store Connect
#        APPLE_API_KEY_PATH     Absolute path to the .p8 private key file
#
# Usage:
#   bash scripts/build-signed-notarized.sh
#   bash scripts/build-signed-notarized.sh --bundles dmg
#   bash scripts/build-signed-notarized.sh --bundles app,dmg
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Source .env.notarize if it exists (keeps secrets out of shell history)
if [[ -f "$ROOT/.env.notarize" ]]; then
  echo "Loading credentials from .env.notarize"
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env.notarize"
  set +a
fi

# ── Validate required env vars ────────────────────────────────────────────────
missing=()
[[ -n "${APPLE_API_KEY:-}" ]]      || missing+=("APPLE_API_KEY")
[[ -n "${APPLE_API_ISSUER:-}" ]]   || missing+=("APPLE_API_ISSUER")
[[ -n "${APPLE_API_KEY_PATH:-}" ]] || missing+=("APPLE_API_KEY_PATH")

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Missing env vars: ${missing[*]}" >&2
  echo "" >&2
  echo "Set them in .env.notarize or export before running this script." >&2
  echo "See: https://appstoreconnect.apple.com/access/integrations/api" >&2
  exit 1
fi

if [[ ! -f "$APPLE_API_KEY_PATH" ]]; then
  echo "APPLE_API_KEY_PATH points to a file that doesn't exist: $APPLE_API_KEY_PATH" >&2
  exit 1
fi

# ── Verify signing identity is in keychain ────────────────────────────────────
IDENTITY="Developer ID Application: frank vitetta (C74NW43986)"
if ! security find-identity -v -p codesigning | grep -q "C74NW43986"; then
  echo "Signing identity not found in keychain: $IDENTITY" >&2
  echo "Import your Developer ID certificate first." >&2
  exit 1
fi

echo ""
echo "┌──────────────────────────────────────────┐"
echo "│  Code Scout — signed + notarized build   │"
echo "├──────────────────────────────────────────┤"
echo "│  Identity : ...C74NW43986                │"
echo "│  API Key  : $APPLE_API_KEY"
echo "│  Issuer   : $APPLE_API_ISSUER"
echo "└──────────────────────────────────────────┘"
echo ""

BUNDLES="${1:-app,dmg}"
# Strip --bundles flag if passed as arg
BUNDLES="${BUNDLES#--bundles }"
BUNDLES="${BUNDLES#--bundles=}"

unset CI

# ── Build frontend ────────────────────────────────────────────────────────────
echo "Building frontend…"
npm run build

if [[ -f "$ROOT/src-tauri/icons/icon.icns" ]]; then
  echo "Icons already exist — skipping generation."
else
  echo "Generating icons…"
  npm run tauri:icon
fi

# ── Tauri build (sign + notarize happen automatically with env vars set) ──────
echo "Running tauri build (sign + notarize)…"
echo "This will submit to Apple and wait for notarization — typically 2–10 minutes."
echo ""

npm exec -- tauri build --bundles "$BUNDLES"

echo ""
echo "Build complete. Checking notarization…"

# ── Verify the .app ──────────────────────────────────────────────────────────
if [[ -d "$ROOT/src-tauri/target/release/bundle/macos/CodeScout.app" ]]; then
  APP_PATH="$ROOT/src-tauri/target/release/bundle/macos/CodeScout.app"
else
  APP_PATH="$ROOT/src-tauri/target/release/bundle/macos/Code Scout.app"
fi
DMG_DIR="$ROOT/src-tauri/target/release/bundle/dmg"

if [[ -d "$APP_PATH" ]]; then
  echo ""
  echo "Verifying .app signature + notarization:"
  codesign --verify --deep --strict --verbose=2 "$APP_PATH" 2>&1 || true
  spctl --assess --type execute --verbose "$APP_PATH" 2>&1 || true
  echo ""
fi

# ── Notarize + staple the DMG (Tauri only notarizes the .app) ────────────────
shopt -s nullglob
DMGS=( "$DMG_DIR"/*.dmg )
shopt -u nullglob
if [[ ${#DMGS[@]} -gt 0 ]]; then
  DMG="$(ls -t "$DMG_DIR"/*.dmg | head -n 1)"
  echo "Notarizing DMG: $(basename "$DMG")"
  echo "Submitting to Apple (this may take a few minutes)…"
  xcrun notarytool submit "$DMG" \
    --key "$APPLE_API_KEY_PATH" \
    --key-id "$APPLE_API_KEY" \
    --issuer "$APPLE_API_ISSUER" \
    --wait

  echo "Stapling notarization ticket to DMG…"
  xcrun stapler staple "$DMG"

  echo ""
  echo "Verifying DMG:"
  spctl --assess --type open --context context:primary-signature --verbose "$DMG" 2>&1 || true
  echo ""
  echo "Ready to distribute: $DMG"
fi

echo ""
echo "Done. This build should open on any Mac without Gatekeeper warnings."
