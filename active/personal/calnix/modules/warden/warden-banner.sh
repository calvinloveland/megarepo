#!/usr/bin/env bash
# Warden login banner — shows host health summary on login
set -euo pipefail

WARDEN_STATE_FILE="${WARDEN_STATE_DIR:-/var/lib/warden}/state.json"

if [ ! -f "$WARDEN_STATE_FILE" ]; then
    echo "  Warden: not initialized — run: wardenctl check all"
    return 0 2>/dev/null || exit 0
fi

# Parse state with jq
if command -v jq &>/dev/null; then
    HOSTNAME=$(jq -r '.hostname // "unknown"' "$WARDEN_STATE_FILE")
    CHECKS=$(jq -r '.checks | to_entries[] | "\(.key):\(.value.status)"' "$WARDEN_STATE_FILE" 2>/dev/null || true)

    # Count statuses
    PASS=$(jq -r '[.checks[] | select(.status == "pass")] | length' "$WARDEN_STATE_FILE" 2>/dev/null || echo 0)
    WARN=$(jq -r '[.checks[] | select(.status == "warn")] | length' "$WARDEN_STATE_FILE" 2>/dev/null || echo 0)
    FAIL=$(jq -r '[.checks[] | select(.status == "fail")] | length' "$WARDEN_STATE_FILE" 2>/dev/null || echo 0)
    TOTAL=$((PASS + WARN + FAIL))

    # Last backup
    LAST_BACKUP=$(jq -r '.backups.last_run // "" | .[0:19]' "$WARDEN_STATE_FILE" 2>/dev/null || echo "")

    if [ "$TOTAL" -gt 0 ]; then
        echo ""
        echo "  ╔═══════════════════════════════════════╗"
        echo "  ║  Warden — $HOSTNAME"
        echo "  ║"
        echo "  ║  Health: ✓ $PASS  ⚠ $WARN  ✗ $FAIL  (${TOTAL} checks)"
        [ -n "$LAST_BACKUP" ] && echo "  ║  Backup: $LAST_BACKUP"
        if [ "$FAIL" -gt 0 ]; then
            FAIL_NAMES=$(jq -r '[.checks[] | select(.status == "fail") | .key] | join(", ")' "$WARDEN_STATE_FILE" 2>/dev/null)
            echo "  ║  Failing: $FAIL_NAMES"
        fi
        echo "  ║"
        echo "  ║  wardenctl status  — full status"
        echo "  ║  wardenctl tail    — recent events"
        echo "  ╚═══════════════════════════════════════╝"
        echo ""
    fi
fi
