#!/usr/bin/env bash
# ==============================================================================
# pi-safe-run.sh — Safer command execution wrapper for Pi's bash tool
#
# Wraps command execution with:
#   1. Shell availability check (prevent "spawn sh ENOENT")
#   2. PATH repair (ensure /run/current-system/sw/bin is in PATH)
#   3. Exit code classification with hints
#   4. Timeout detection and advice
#
# Usage:
#   pi-safe-run.sh [--timeout SECS] <command...>
#   pi-safe-run.sh --python <script>          # Run with detected Python
# ==============================================================================
set -euo pipefail

YELLOW='\033[1;33m'
NC='\033[0m'

# Ensure essential paths
export PATH="/run/current-system/sw/bin:$HOME/.local/bin:$HOME/.nix-profile/bin:/nix/var/nix/profiles/default/bin:$PATH"

TIMEOUT=""
CMD=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --timeout)
            TIMEOUT="$2"; shift 2 ;;
        --python)
            shift
            # Find Python
            PY=""
            for p in python3 python3.13 python3.12 python3.11 python; do
                if command -v "$p" &>/dev/null; then
                    PY="$p"; break
                fi
            done
            if [[ -z "$PY" ]]; then
                echo "ERROR: No Python found. Try: nix-shell -p python3" >&2
                echo "HINT:pi-safe-run:no-python"
                exit 127
            fi
            # Check for nix-shell if python3 specifically is needed but only python is available
            if [[ "$PY" == "python" && ! "$*" =~ "python3" ]]; then
                # python is fine for most scripts
                :
            fi
            exec "$PY" "$@"
            ;;
        *)
            CMD+=("$1"); shift ;;
    esac
done

if [[ ${#CMD[@]} -eq 0 ]]; then
    echo "Usage: pi-safe-run.sh [--timeout SECS] [--python] <command...>" >&2
    exit 1
fi

# Pre-check: does the command look valid?
exe="${CMD[0]}"
if ! command -v "$exe" &>/dev/null; then
    echo "WARNING: '$exe' not found in PATH" >&2
    echo "HINT:pi-safe-run:cmd-not-found:$exe" >&2
    echo "PATH=$PATH" >&2
    
    # Suggest nix-shell if on NixOS
    if command -v nix-shell &>/dev/null; then
        echo "SUGGESTION: nix-shell -p $exe --command '${CMD[*]}'" >&2
    fi
fi

# Run the command
if [[ -n "$TIMEOUT" ]]; then
    timeout "$TIMEOUT" "${CMD[@]}"
else
    "${CMD[@]}"
fi

exit_code=$?

# Classify exit code
case $exit_code in
    0)  ;;
    1)  echo "HINT:pi-safe-run:exit-1:general-error" >&2 ;;
    2)  echo "HINT:pi-safe-run:exit-2:usage-or-parse-error" >&2 ;;
    124) 
        echo "HINT:pi-safe-run:timeout" >&2 
        echo "SUGGESTION: Increase timeout (--timeout) or split work into smaller chunks." >&2
        ;;
    126) echo "HINT:pi-safe-run:exit-126:not-executable" >&2 ;;
    127) 
        echo "HINT:pi-safe-run:exit-127:command-not-found" >&2
        echo "The command '$exe' was not found. Check PATH or install the tool." >&2
        if command -v nix-shell &>/dev/null; then
            echo "SUGGESTION: nix-shell -p $exe --command '${CMD[*]}'" >&2
        fi
        ;;
    137) echo "HINT:pi-safe-run:exit-137:killed (OOM or signal)" >&2 ;;
    *)   echo "HINT:pi-safe-run:exit-$exit_code" >&2 ;;
esac

exit $exit_code
