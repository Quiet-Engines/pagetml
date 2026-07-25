#!/usr/bin/env bash
# File-association verification (QE-1447) — macOS only.
#
# Builds the real .app bundle and proves that opening an .html through Launch
# Services (as the OS does on double-click / "Open with") reaches the app via
# RunEvent::Opened and actually opens + paginates the document — the full
# native path a dev binary can't exercise (dev binaries don't receive the OS
# open event).
#
# Regression guard for the startup-race bug this caught: RunEvent::Opened can
# fire before setup() initializes the store, so open_path must initialize it
# itself (ensure_store_loaded) or the opened document is silently dropped.
#
# Oracle: the persistent store. The opened file lands there (canonical path)
# with a saved position only if the whole chain ran — Opened → open_path →
# store → chrome load → runtime boot → paginate → set_position. The release
# .app is self-contained (embedded assets), so no dev server is needed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
APP="$ROOT/src-tauri/target/release/bundle/macos/PageTML.app"
BUNDLE_ID="app.quietengines.pagetml"
STORE="$HOME/Library/Application Support/$BUNDLE_ID/store.json"
LSREG="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
WORK="$(mktemp -d)"

fail() { echo "FILEASSOC FAIL: $1" >&2; exit 1; }

SAVED=""
[ -f "$STORE" ] && { SAVED="$(mktemp)"; cp "$STORE" "$SAVED"; }
cleanup() {
  pkill -f 'PageTML.app' 2>/dev/null || true
  rm -rf "$WORK"; rm -f "$STORE"
  [ -n "$SAVED" ] && mv "$SAVED" "$STORE" 2>/dev/null || true
}
trap cleanup EXIT

echo "[build] release .app bundle (arm64, unsigned)"
npx tauri build --bundles app >/dev/null 2>&1
[ -d "$APP" ] || fail "no .app bundle produced"

echo "[register] Launch Services"
"$LSREG" -f "$APP" >/dev/null 2>&1
# CFBundleDocumentTypes must declare html as a handler.
/usr/libexec/PlistBuddy -c "Print :CFBundleDocumentTypes:0:CFBundleTypeExtensions" \
  "$APP/Contents/Info.plist" 2>/dev/null | grep -q html \
  || fail "Info.plist does not declare .html as a document type"

echo "[open] a .html via the bundle (fresh launch → RunEvent::Opened)"
pkill -f 'PageTML.app' 2>/dev/null || true; sleep 2
rm -f "$STORE"
cp public/fixtures/prose.html "$WORK/report.html"
open -a "$APP" "$WORK/report.html"
for _ in $(seq 1 40); do
  [ -f "$STORE" ] && python3 - "$STORE" <<'PY' 2>/dev/null && break || sleep 0.25
import json, sys
e = json.load(open(sys.argv[1]))
sys.exit(0 if e and e[0].get("position") else 1)
PY
done

python3 - "$STORE" "$WORK/report.html" <<'PY' || fail "opened file did not reach the store with a saved position (Opened → open_path → paginate chain broken)"
import json, os, sys
e = json.load(open(sys.argv[1]))
assert e, "store empty — the opened document was dropped"
assert e[0]["path"] == os.path.realpath(sys.argv[2]), f"wrong/uncanonical path: {e[0]['path']}"
assert e[0].get("position"), "no saved position — the document did not paginate"
PY
echo "  ok — opened via file association, stored canonical path, paginated"

echo "FILEASSOC PASS"
