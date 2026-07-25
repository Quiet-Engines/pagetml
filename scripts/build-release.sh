#!/usr/bin/env bash
# Signed + notarized macOS release build (QE-1448) — macOS only.
#
# `tauri build` performs the Developer ID signing + notarization itself when the
# signing env is present (see src-tauri/NOTES.md); this wraps it and VERIFIES
# the result — a signing/notarization misconfig otherwise ships a build macOS
# will refuse to open. Checks: valid signature, hardened runtime enabled, the
# WebKit-JIT entitlements applied, Gatekeeper acceptance, and the notarization
# ticket stapled.
#
# Requires the Developer ID Application cert in the login keychain and the
# notarization credentials in the environment (see NOTES.md). With `--verify-only`
# it skips the build and just audits the most recent bundle — used to prove the
# checks fire (an ad-hoc build fails them).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
APP="src-tauri/target/release/bundle/macos/PageTML.app"

fail() { echo "RELEASE FAIL: $1" >&2; exit 1; }
pass() { echo "  ok — $1"; }

VERIFY_ONLY=0
[ "${1:-}" = "--verify-only" ] && VERIFY_ONLY=1

if [ "$VERIFY_ONLY" = 0 ]; then
  [ -n "${APPLE_SIGNING_IDENTITY:-}" ] || fail "APPLE_SIGNING_IDENTITY not set — Developer ID cert + notarization creds required (see src-tauri/NOTES.md)"
  echo "[build] tauri build (signed + notarized: $APPLE_SIGNING_IDENTITY)"
  npx tauri build   # signs + notarizes from the environment
fi

[ -d "$APP" ] || fail "no .app bundle at $APP"

echo "[verify] signature + hardened runtime + entitlements + Gatekeeper + notarization"
codesign --verify --deep --strict --verbose=2 "$APP" 2>/dev/null || fail "signature does not verify"
pass "signature verifies"

codesign -dv "$APP" 2>&1 | grep -q 'flags=.*runtime' || fail "hardened runtime not enabled (Developer ID signing applies it; ad-hoc does not)"
pass "hardened runtime enabled"

ents="$(codesign -d --entitlements - --xml "$APP" 2>/dev/null)"
echo "$ents" | grep -q 'com.apple.security.cs.allow-jit' || fail "WebKit-JIT entitlement missing"
pass "hardened-runtime entitlements applied"

spctl -a -vvv -t exec "$APP" 2>&1 | grep -q 'accepted' || fail "Gatekeeper rejects the app (not signed with Developer ID + notarized)"
pass "Gatekeeper accepts"

xcrun stapler validate "$APP" >/dev/null 2>&1 || fail "notarization ticket not stapled"
pass "notarization stapled"

echo "RELEASE OK"
