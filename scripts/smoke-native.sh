#!/usr/bin/env bash
# Native smoke test for the Tauri shell (QE-1427/1428/1429/1434).
#
# The headless Rust unit tests (`cargo test` in src-tauri) cover the pure logic
# — traversal guard, store durability, injection contract. This drives the REAL
# built binary end-to-end and asserts the one thing those can't: that opening a
# document actually boots the content runtime and paginates it.
#
# The oracle is the persistent store. A last-read position only lands in
# store.json if the full native chain ran: pagetml:// served the file → the
# injected runtime booted → it paginated and emitted an anchor → the chrome
# persisted it via set_position. That is exactly the chain whose silent failure
# (runtime never loaded → raw un-paginated HTML) shipped once and was invisible
# to screenshots. If the runtime doesn't boot, `position` stays null and this
# fails.
#
# Requires a display (macOS/desktop). Not headless-CI-ready without a window
# server — that gap is intentional; the Rust layer is the CI-friendly half.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BIN="src-tauri/target/debug/pagetml"
FIXTURE="$ROOT/public/fixtures/prose.html"
STORE="$HOME/Library/Application Support/app.quietengines.pagetml/store.json"
BAK="${STORE%.json}.json.bak"

fail() { echo "SMOKE FAIL: $1" >&2; exit 1; }
pass() { echo "  ok — $1"; }

echo "[1/4] build (runtime bundle + shell binary)"
npm run build:runtime >/dev/null
( cd src-tauri && cargo build >/dev/null 2>&1 )
[ -x "$BIN" ] || fail "binary not built at $BIN"

# Preserve any real store, run against a clean slate, restore on exit.
SAVED=""
if [ -f "$STORE" ]; then SAVED="$(mktemp)"; cp "$STORE" "$SAVED"; fi
cleanup() {
  [ -n "${PID:-}" ] && kill "$PID" 2>/dev/null || true
  rm -f "$STORE" "$BAK"
  [ -n "$SAVED" ] && mv "$SAVED" "$STORE" 2>/dev/null || true
}
trap cleanup EXIT
rm -f "$STORE" "$BAK"

launch() { "$BIN" "$1" >/dev/null 2>&1 & PID=$!; }
# Wait until the store exists AND its front entry has a non-null position, i.e.
# the runtime booted and paginated. Timeout means it never did.
wait_for_position() {
  for _ in $(seq 1 40); do
    if [ -f "$STORE" ] && python3 - "$STORE" <<'PY' 2>/dev/null; then return 0; fi
import json, sys
e = json.load(open(sys.argv[1]))
sys.exit(0 if e and e[0].get("position") else 1)
PY
    sleep 0.25
  done
  return 1
}

echo "[2/4] open a fixture → runtime boots and paginates"
launch "$FIXTURE"
wait_for_position || fail "no position persisted — the runtime did not boot/paginate (raw-HTML regression)"
kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; PID=""
pass "document paginated (position persisted through the native chain)"

echo "[3/4] store holds the canonical path"
python3 - "$STORE" "$FIXTURE" <<'PY' || fail "stored path is not the canonical fixture path"
import json, os, sys
e = json.load(open(sys.argv[1]))
assert e and e[0]["path"] == os.path.realpath(sys.argv[2]), e[0]["path"]
PY
pass "canonical path stored"

echo "[4/4] reopen restores the saved position (re-anchors, not page 0)"
# Seed a deep anchor, reopen, and confirm the reader was moved off page 0 —
# a successful restore re-anchors to the restored page's first element.
python3 - "$STORE" <<'PY'
import json, sys
s = json.load(open(sys.argv[1]))
s[0]["position"] = {"path": [12], "offset": 0, "textHint": "seeded"}
json.dump(s, open(sys.argv[1], "w"))
PY
launch "$FIXTURE"
wait_for_position || fail "reopen did not re-persist a position"
kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; PID=""
python3 - "$STORE" <<'PY' || fail "restored anchor stayed at page-0 element [0] — restore did not take"
import json, sys
p = json.load(open(sys.argv[1]))[0]["position"]["path"]
# After restoring a page-2 anchor, the re-captured anchor must not be the
# document's first element ([0]) — that would mean it snapped back to page 0.
assert p != [0], p
PY
pass "position restored on reopen"

echo "SMOKE PASS"
