#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-5192}"
BASE="http://127.0.0.1:$PORT"
PASS=0
FAIL=0

pass() { PASS=$((PASS+1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL+1)); echo "  ❌ $1"; }

check_html() {
  local html
  html=$(curl -s "$BASE/")
  echo "$html" | grep -qF 'id="sandboxCanvas"' && pass 'canvas present' || fail 'canvas missing'
  echo "$html" | grep -qF 'id="playPauseButton"' && pass 'play button present' || fail 'play button missing'
  echo "$html" | grep -qF 'id="stepButton"' && pass 'step button present' || fail 'step button missing'
  echo "$html" | grep -qF 'id="canvasToolbar"' && pass 'canvas toolbar present' || fail 'canvas toolbar missing'
  echo "$html" | grep -qF 'id="telemetryToggle"' && pass 'telemetry toggle present' || fail 'telemetry toggle missing'
  echo "$html" | grep -qF 'id="selectionLabel"' && pass 'selection label present' || fail 'selection label missing'
  echo "$html" | grep -qF 'data-workspace-tab="feedback"' && pass 'feedback tab present' || fail 'feedback tab missing'
  echo "$html" | grep -qF 'src="./app.js"' && pass 'script tag present' || fail 'script tag missing'
  echo "$html" | grep -qF 'data-preset=' && fail 'preset buttons still present' || pass 'no preset buttons'
}

check_js() {
  local js
  js=$(curl -s "$BASE/app.js")
  echo "$js" | grep -qF 'function simulationStep' && pass 'app.js simulationStep defined' || fail 'app.js missing simulationStep'
  echo "$js" | grep -qF 'function render' && pass 'app.js render defined' || fail 'app.js missing render'
  echo "$js" | grep -qF 'function cellOpacity' && pass 'app.js cellOpacity defined' || fail 'app.js missing cellOpacity'
  echo "$js" | grep -qF 'function submitAllFeedback' && pass 'app.js submitAllFeedback defined' || fail 'app.js missing submitAllFeedback'
  echo "$js" | grep -qF 'function updateUi' && pass 'app.js updateUi defined' || fail 'app.js missing updateUi'
}

check_mime() {
  local ct
  ct=$(curl -sI "$BASE/sim-core.mjs" | grep -i 'content-type:')
  echo "$ct" | grep -qi 'application/javascript' && pass 'sim-core.mjs JS MIME type' || fail 'sim-core.mjs wrong MIME type'
}

check_api() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/feedback" \
    -H 'content-type: application/json' -d '{"from":"smoke-test"}')
  [ "$code" = "200" ] && pass 'POST /api/feedback returns 200' || fail "POST /api/feedback returned $code"
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/feedback")
  [ "$code" = "200" ] && pass 'GET /api/feedback returns 200' || fail "GET /api/feedback returned $code"
}

check_node() {
  node --check "$(dirname "$0")/../app.js" 2>/dev/null && pass 'app.js syntax OK' || fail 'app.js syntax error'
  node --check "$(dirname "$0")/../server.mjs" 2>/dev/null && pass 'server.mjs syntax OK' || fail 'server.mjs syntax error'
  node --check "$(dirname "$0")/../sim-core.mjs" 2>/dev/null && pass 'sim-core.mjs syntax OK' || fail 'sim-core.mjs syntax error'
}

echo "=== Smoke tests ==="
check_node
check_html
check_js
check_mime
check_api
echo ""
echo "Pass: $PASS / Fail: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
