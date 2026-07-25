#!/usr/bin/env bash
# WKWebView fragmentation validation (QE-1445) — macOS only.
#
# Runs the pagination invariant suite inside the REAL system WKWebView (via
# wry), not Playwright's bundled WebKit. The M1 go/no-go and the engine suite
# run on Playwright's WebKit, which this session proved differs from the
# WKWebView the app actually ships on (CSP connect-src). This validates that
# column fragmentation and break-* handling produce correct pagination — no
# clipping, full reachability — on the shipping engine.
#
# The shell (with PAGETML_HARNESS set) loads harness/index.html?report=1 in its
# real webview; the harness iterates the fixture corpus × sizes, runs the
# invariant checks, and posts them to the `report_invariants` command, which
# prints them and exits. This asserts none report clipping or unreachable
# fragments.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
BIN="src-tauri/target/debug/pagetml"
DEV_URL="http://localhost:5179/harness/index.html"

fail() { echo "FRAG FAIL: $1" >&2; exit 1; }

VITE_PID=""
cleanup() { [ -n "$VITE_PID" ] && kill "$VITE_PID" 2>/dev/null || true; }
trap cleanup EXIT

echo "[build] runtime + debug binary"
npm run build:runtime >/dev/null
( cd src-tauri && cargo build >/dev/null 2>&1 )
[ -x "$BIN" ] || fail "binary not built"

if ! curl -sf -o /dev/null "$DEV_URL"; then
  npx vite --port 5179 >/dev/null 2>&1 & VITE_PID=$!
  for _ in $(seq 1 60); do curl -sf -o /dev/null "$DEV_URL" && break; sleep 0.25; done
  curl -sf -o /dev/null "$DEV_URL" || fail "vite did not serve the harness"
fi

echo "[run] invariant suite inside the real WKWebView"
OUT="$(mktemp)"
# Cap the run: the harness reports then the process exits; kill if it hangs.
( PAGETML_HARNESS=1 "$BIN" >"$OUT" 2>/dev/null ) &
APP=$!
for _ in $(seq 1 60); do grep -q PAGETML_INVARIANTS "$OUT" && break; kill -0 "$APP" 2>/dev/null || break; sleep 0.5; done
kill "$APP" 2>/dev/null || true

grep -q PAGETML_INVARIANTS "$OUT" || { cat "$OUT"; fail "no invariant results (harness didn't run/report in the webview)"; }

python3 - "$OUT" <<'PY' || fail "invariant violations on the real WKWebView"
import json, re, sys
line = next(l for l in open(sys.argv[1]) if l.startswith("PAGETML_INVARIANTS"))
results = json.loads(line.split(" ", 1)[1])
assert results, "empty results"
bad = [r for r in results if r["clipping"] or r["unreachable"]]
trivial = [r for r in results if r["pageCount"] < 1]
n = len(results)
for r in bad:
    print(f"  CLIP/UNREACH {r['fixture']} @ {r['w']}x{r['h']}: "
          f"clipping={r['clipping']} unreachable={r['unreachable']}")
for r in trivial:
    print(f"  TRIVIAL {r['fixture']} @ {r['w']}x{r['h']}: pageCount={r['pageCount']}")
if bad or trivial:
    sys.exit(1)
print(f"  ok — {n} fixture×size checks, no clipping, no unreachable, all paginated")
PY

echo "FRAG PASS"
