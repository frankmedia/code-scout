#!/usr/bin/env bash
# Build, sign, notarize, and staple Code Scout for macOS distribution.
#
# Strategy: Tauri builds + signs + notarizes + staples the .app (its bundle_dmg.sh is
# flaky due to AppleScript Finder window-positioning, so we bypass it entirely).
# Then we manually create the DMG with `hdiutil`, sign it, notarize it via
# `notarytool submit --wait`, and staple it.
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
#   bash scripts/build-signed-notarized.sh --skip-tauri-build   # reuse existing .app
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

SKIP_TAURI_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --skip-tauri-build) SKIP_TAURI_BUILD=1 ;;
  esac
done

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

VERSION="$(node -p "require('$ROOT/package.json').version")"
APP_DIR="$ROOT/src-tauri/target/release/bundle/macos"
DMG_DIR="$ROOT/src-tauri/target/release/bundle/dmg"

echo ""
echo "┌──────────────────────────────────────────┐"
echo "│  Code Scout — signed + notarized build   │"
echo "├──────────────────────────────────────────┤"
echo "│  Version  : ${VERSION}"
echo "│  Identity : ...C74NW43986                │"
echo "│  API Key  : $APPLE_API_KEY"
echo "│  Issuer   : $APPLE_API_ISSUER"
echo "└──────────────────────────────────────────┘"
echo ""

# ── Pre-build cleanup: detach stale DMG mounts + remove leftover rw.*.dmg ─────
echo "Cleaning up any stale DMG state from previous builds…"

# Detach any leftover mount points from an aborted run
for vol in "/Volumes/CodeScout" "/Volumes/Code Scout" "/Volumes/dmg."*; do
  if [[ -d "$vol" ]]; then
    echo "  Detaching stale volume: $vol"
    hdiutil detach "$vol" -force >/dev/null 2>&1 || true
  fi
done

# Remove rw.*.dmg working files Tauri's bundle_dmg.sh leaves behind on failure
if [[ -d "$APP_DIR" ]]; then
  find "$APP_DIR" -maxdepth 1 -name "rw.*.dmg" -print -delete 2>/dev/null || true
fi

unset CI

# ── Frontend + Tauri build (signs + notarizes + staples the .app) ────────────
if [[ "$SKIP_TAURI_BUILD" -eq 0 ]]; then
  echo ""
  echo "Building frontend…"
  npm run build

  if [[ -f "$ROOT/src-tauri/icons/icon.icns" ]]; then
    echo "Icons already exist — skipping generation."
  else
    echo "Generating icons…"
    npm run tauri:icon
  fi

  echo ""
  echo "Running tauri build (.app only — DMG is built manually below)…"
  echo "Tauri will sign, notarize, and staple the .app automatically."
  echo "This typically takes 5–15 minutes (compile + Apple notary)."
  echo ""

  # Build only the .app target. We bypass Tauri's bundle_dmg.sh which is flaky
  # due to AppleScript window positioning.
  npm exec -- tauri build --bundles app
else
  echo "Skipping tauri build (--skip-tauri-build) — reusing existing .app."
fi

# ── Locate the .app ──────────────────────────────────────────────────────────
if [[ -d "$APP_DIR/CodeScout.app" ]]; then
  APP_NAME="CodeScout.app"
elif [[ -d "$APP_DIR/Code Scout.app" ]]; then
  APP_NAME="Code Scout.app"
else
  echo "ERROR: No .app bundle found in $APP_DIR" >&2
  echo "Tauri build likely failed — check output above." >&2
  exit 1
fi
APP_PATH="$APP_DIR/$APP_NAME"

# ── If the .app is unsigned (e.g. --skip-tauri-build on a stale build),
#    sign + notarize + staple it now.
echo ""
echo "Verifying .app signature…"
if codesign --verify --deep --strict --verbose=2 "$APP_PATH" >/dev/null 2>&1; then
  echo "  .app is already signed."
else
  echo "  .app is unsigned — signing now…"
  codesign --force --deep --options runtime --timestamp \
    --entitlements "$ROOT/src-tauri/entitlements.plist" \
    --sign "$IDENTITY" "$APP_PATH"
fi

if xcrun stapler validate "$APP_PATH" >/dev/null 2>&1; then
  echo "  .app is already notarized + stapled."
else
  echo "  .app needs notarization — submitting…"
  APP_ZIP="$(mktemp -t codescout-app).zip"
  rm -f "$APP_ZIP"
  ditto -c -k --keepParent "$APP_PATH" "$APP_ZIP"
  xcrun notarytool submit "$APP_ZIP" \
    --key "$APPLE_API_KEY_PATH" \
    --key-id "$APPLE_API_KEY" \
    --issuer "$APPLE_API_ISSUER" \
    --wait
  rm -f "$APP_ZIP"
  echo "  Stapling .app…"
  xcrun stapler staple "$APP_PATH"
fi

echo ""
echo "Final .app verification:"
codesign --verify --deep --strict --verbose=2 "$APP_PATH" 2>&1 || true
spctl --assess --type execute --verbose "$APP_PATH" 2>&1 || true

# ── Manually create the DMG (replaces Tauri's flaky bundle_dmg.sh) ───────────
mkdir -p "$DMG_DIR"
DMG_NAME="CodeScout_${VERSION}_aarch64.dmg"
DMG="$DMG_DIR/$DMG_NAME"

# Remove any prior DMG with the same name
rm -f "$DMG"

echo ""
echo "Creating DMG with hdiutil → $DMG_NAME"

# Use a multi-step "create blank → attach (mount OUTSIDE /Volumes) → ditto →
# detach → convert" pattern. We must mount outside /Volumes because that path
# is TCC-protected on modern macOS and ditto/cp into /Volumes/* fails with
# "Operation not permitted" unless Terminal has Full Disk Access. Mounting
# under $TMPDIR avoids that requirement entirely.

# Detach any leftover /Volumes/CodeScout mount from a previous failed attempt
if [[ -d "/Volumes/CodeScout" ]]; then
  hdiutil detach "/Volumes/CodeScout" -force >/dev/null 2>&1 || true
fi

# Calculate DMG size: app size × 1.5, minimum 200 MB
APP_SIZE_KB=$(du -sk "$APP_PATH" | cut -f1)
DMG_SIZE_KB=$(( APP_SIZE_KB * 3 / 2 ))
[[ $DMG_SIZE_KB -lt 204800 ]] && DMG_SIZE_KB=204800
DMG_SIZE_MB=$(( DMG_SIZE_KB / 1024 + 1 ))

TMP_WORK_DIR="$(mktemp -d -t codescout-dmg)"
TMP_DMG="$TMP_WORK_DIR/working.dmg"
MOUNT_PT="$TMP_WORK_DIR/mnt"
mkdir -p "$MOUNT_PT"

cleanup_dmg_stage() {
  if [[ -n "${MOUNT_PT:-}" && -d "$MOUNT_PT" ]]; then
    hdiutil detach "$MOUNT_PT" -force >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_WORK_DIR" 2>/dev/null || true
}
trap cleanup_dmg_stage EXIT

echo "  Creating ${DMG_SIZE_MB}MB blank R/W DMG → $TMP_DMG"
hdiutil create \
  -size "${DMG_SIZE_MB}m" \
  -fs "HFS+J" \
  -volname "CodeScout" \
  -ov \
  "$TMP_DMG" >/dev/null

echo "  Attaching at $MOUNT_PT (outside /Volumes to avoid TCC restrictions)…"
hdiutil attach "$TMP_DMG" \
  -mountpoint "$MOUNT_PT" \
  -nobrowse \
  -noautoopen >/dev/null

echo "  Copying $APP_NAME via ditto (preserves xattrs)…"
ditto "$APP_PATH" "$MOUNT_PT/$APP_NAME"

echo "  Detaching…"
hdiutil detach "$MOUNT_PT" >/dev/null 2>&1 || hdiutil detach "$MOUNT_PT" -force >/dev/null
MOUNT_PT=""

echo "  Converting to UDZO compressed read-only DMG…"
rm -f "$DMG"
hdiutil convert "$TMP_DMG" -format UDZO -o "$DMG" >/dev/null

rm -rf "$TMP_WORK_DIR"
trap - EXIT

echo "Signing DMG…"
codesign --force --sign "$IDENTITY" --timestamp "$DMG"

# ── Notarize + staple the DMG ────────────────────────────────────────────────
echo ""
echo "Notarizing DMG: $DMG_NAME"
echo "Submitting to Apple (this may take a few minutes)…"
xcrun notarytool submit "$DMG" \
  --key "$APPLE_API_KEY_PATH" \
  --key-id "$APPLE_API_KEY" \
  --issuer "$APPLE_API_ISSUER" \
  --wait

echo ""
echo "Stapling notarization ticket to DMG…"
xcrun stapler staple "$DMG"

echo ""
echo "Final DMG verification:"
spctl --assess --type open --context context:primary-signature --verbose "$DMG" 2>&1 || true
xcrun stapler validate "$DMG" 2>&1 || true

# ── Final assertion ──────────────────────────────────────────────────────────
if [[ ! -f "$DMG" ]]; then
  echo "ERROR: DMG was not produced at $DMG" >&2
  exit 1
fi

echo ""
echo "✓ Ready to distribute: $DMG"
echo ""
echo "Done. This build opens on any Mac without Gatekeeper warnings."
