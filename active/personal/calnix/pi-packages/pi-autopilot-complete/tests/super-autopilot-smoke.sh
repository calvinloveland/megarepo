#!/usr/bin/env bash
# ── live super-autopilot smoke test ──────────────────────────────────────────
#
# Spawns `pi --mode json` with the extension loaded, enables super autopilot,
# sends a task, and watches for the multi-turn follow-up cycle.
#
# Requirements:
#   - pi binary on PATH
#   - a working LLM provider with tool support (e.g. github-copilot, anthropic)
#   - the extension directory reachable from the package root
#
# Usage:
#   # Specify model via env var:
#   PI_BIN=pi SMOKE_MODEL=github-copilot/claude-haiku-4.5 bash tests/super-autopilot-smoke.sh
#
#   # Or via first argument:
#   bash tests/super-autopilot-smoke.sh github-copilot/claude-haiku-4.5
#
#   # Override timeout:
#   SMOKE_TIMEOUT=120 bash tests/super-autopilot-smoke.sh
#
# Returns 0 if at least one "=== NEXT TASK ===" cycle was observed.
# Returns non-zero otherwise.
# ──────────────────────────────────────────────────────────────────────────────

set -uo pipefail

# Parse arguments
MIN_CYCLES=1
MODEL_FLAG=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --min-cycles)
            MIN_CYCLES="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [model] [--min-cycles N]"
            echo "  model         Provider/model string (e.g. github-copilot/claude-haiku-4.5)"
            echo "  --min-cycles N  Minimum required NEXT TASK cycles (default: 1)"
            echo "  --help, -h     Show this help"
            exit 0
            ;;
        -*)
            echo "Unknown option: $1"
            exit 1
            ;;
        *)
            MODEL_FLAG="--model $1"
            shift
            ;;
    esac
done

# Fall back to env var if no model was specified on CLI
if [[ -z "$MODEL_FLAG" && -n "${SMOKE_MODEL:-}" ]]; then
    MODEL_FLAG="--model ${SMOKE_MODEL}"
fi

# Allow PI_BIN to include extra flags (e.g. "pi --model foo/bar")
PI="${PI_BIN:-pi}"
# shellcheck disable=SC2206
PI_CMD=($PI $MODEL_FLAG)
PKG_DIR="$(cd "$(dirname "$0")"/.. && pwd)"
TIMEOUT_SEC="${SMOKE_TIMEOUT:-90}"

echo "[smoke] pi binary:  ${PI_CMD[0]}"
echo "[smoke] args:       ${PI_CMD[*]:1}"
echo "[smoke] package:    $PKG_DIR"
echo "[smoke] timeout:    ${TIMEOUT_SEC}s"

# Verify pi exists
if ! command -v "${PI_CMD[0]}" &>/dev/null; then
    echo "[FAIL] pi binary not found: ${PI_CMD[0]}"
    echo "       Set PI_BIN or install pi."
    exit 1
fi

# Verify the extension file exists
EXT_FILE="$PKG_DIR/extensions/autopilot-complete.ts"
if [[ ! -f "$EXT_FILE" ]]; then
    echo "[FAIL] extension not found: $EXT_FILE"
    exit 1
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

OUTFILE="$WORKDIR/pi-output.ndjson"
ERRFILE="$WORKDIR/pi-err.log"

# Build a command that enables super autopilot and sends a task
CMD="
/superautopilot on
Write a one-line Python function that computes factorial. When done, call complete with futureWork: ['Add type hints', 'Add docstring'].
"

echo "[smoke] Starting pi session..."
echo "[smoke] Command: ${PI_CMD[*]} --mode json -e \"$PKG_DIR\" --no-skills --no-context-files --no-prompt-templates --print"

timeout "$TIMEOUT_SEC" "${PI_CMD[@]}" --mode json \
    -e "$PKG_DIR" \
    --no-skills \
    --no-context-files \
    --no-prompt-templates \
    --print \
    "$CMD" \
    > "$OUTFILE" 2>"$ERRFILE" \
    || true

echo "[smoke] Session ended. Analyzing output..."
echo "[smoke] Event count: $(wc -l < "$OUTFILE" || true)"

# ── Check for key events ────────────────────────────────────────────────────
NEXT_TASK_COUNT=$(grep -c '=== NEXT TASK ===' "$OUTFILE" 2>/dev/null || true)
COMPLETE_CALLS=$(grep -c '"complete"' "$OUTFILE" 2>/dev/null || true)
AGENT_END_COUNT=$(grep -c '"type":"agent_end"' "$OUTFILE" 2>/dev/null || true)
TOOL_CALL_COUNT=$(grep -c 'toolCall' "$OUTFILE" 2>/dev/null || true)

echo "[smoke] 'NEXT TASK' occurrences: $NEXT_TASK_COUNT"
echo "[smoke] complete tool calls:      $COMPLETE_CALLS"
echo "[smoke] 'agent_end' events:       $AGENT_END_COUNT"
echo "[smoke] tool calls in total:      $TOOL_CALL_COUNT"

if [[ "$NEXT_TASK_COUNT" -lt "$MIN_CYCLES" ]]; then
    echo "[INFO] stderr tail:"
    tail -20 "$ERRFILE" 2>/dev/null || true
    echo ""
    echo "[FAIL] Expected at least $MIN_CYCLES '=== NEXT TASK ===' cycle(s), got $NEXT_TASK_COUNT."
    echo "       Events: $AGENT_END_COUNT agent_end, $COMPLETE_CALLS complete calls"
    echo ""
    echo "       Possible causes:"
    echo "       - The model finished in one shot without calling complete"
    echo "       - The provider/model doesn't support tool calling"
    echo "       - The extension failed to load (check stderr)"
    echo "       - No valid API key is configured"
    if [[ "$TOOL_CALL_COUNT" -eq 0 ]]; then
        echo "       The model never called any tool - likely a provider limitation."
    fi
    exit 1
fi

echo "[PASS] Super autopilot produced $NEXT_TASK_COUNT '=== NEXT TASK ===' cycle(s) (min: $MIN_CYCLES)."
echo "[smoke] All checks passed. ✅"
exit 0
