#!/usr/bin/env bash
# ==============================================================================
# pi-preflight.sh — Pre-session sanity checks for Pi agent tooling
#
# Run before or at the start of a Pi session to catch common failure patterns
# before they waste agent context. Semi-exits: prints warnings but only exits
# non-zero for hard-blockers (no shell, no PATH).
#
# Usage:  pi-preflight.sh [--fix]
#   --fix   Attempt to fix detected issues (e.g., create python3 symlink)
# ==============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

issues=0
fixes=0
FIX_MODE=false
[[ "${1:-}" == "--fix" ]] && FIX_MODE=true

check() {
    local desc="$1" cmd="$2" severity="${3:-warn}" fix_hint="${4:-}"
    if eval "$cmd" &>/dev/null; then
        echo -e "  ${GREEN}✓${NC} $desc"
        return 0
    else
        echo -e "  ${RED}✗${NC} $desc"
        if [[ "$severity" == "fail" ]]; then
            issues=$((issues + 1))
        fi
        if [[ -n "$fix_hint" ]]; then
            echo -e "    ${YELLOW}→${NC} $fix_hint"
            if $FIX_MODE; then
                echo -e "    ${YELLOW}→${NC} Attempting fix..."
            fi
        fi
        return 1
    fi
}

echo "=== Pi Pipeline Preflight ==="
echo "Host: $(hostname)"
echo "CWD:  $(pwd)"
echo

# ── 1. Shell availability (HARD BLOCKER for bash tool) ─────────────────────
echo "--- Shell & PATH ---"
if ! command -v sh &>/dev/null; then
    echo -e "  ${RED}✗ FATAL: sh not in PATH${NC}"
    echo "    The bash tool requires 'sh' to spawn subprocesses."
    echo "    On NixOS: add bash to environment.systemPackages or use nix-shell."
    issues=$((issues + 100))
else
    echo -e "  ${GREEN}✓${NC} sh available at $(which sh)"
fi

check "bash available" "command -v bash" fail \
    "nix-shell -p bash"

check "coreutils (ls, cat, etc.)" "command -v ls" fail \
    "nix-shell -p coreutils"

# ── 2. Python availability ────────────────────────────────────────────────
echo
echo "--- Python ---"

PYTHON_CMD=""
for p in python3 python3.13 python3.12 python3.11 python; do
    if command -v "$p" &>/dev/null; then
        PYTHON_CMD="$p"
        echo -e "  ${GREEN}✓${NC} $p available at $(which "$p")"
        break
    fi
done

if [[ -z "$PYTHON_CMD" ]]; then
    echo -e "  ${RED}✗${NC} No Python found in PATH"
    echo -e "    ${YELLOW}→${NC} Pi often needs python3. Install: nix-shell -p python3"
    issues=$((issues + 1))
elif [[ "$PYTHON_CMD" != "python3" ]]; then
    echo -e "  ${YELLOW}⚠${NC} 'python3' not in PATH, but '$PYTHON_CMD' is"
    echo -e "    ${YELLOW}→${NC} Pi's inner scripts may invoke 'python3' and fail."
    if $FIX_MODE; then
        # Try to create a python3 → python symlink in ~/.local/bin
        mkdir -p "$HOME/.local/bin"
        if [[ ! -e "$HOME/.local/bin/python3" ]]; then
            ln -s "$(which "$PYTHON_CMD")" "$HOME/.local/bin/python3"
            echo -e "    ${GREEN}→${NC} Created symlink: ~/.local/bin/python3 → $(which "$PYTHON_CMD")"
            fixes=$((fixes + 1))
            # Ensure ~/.local/bin is in PATH
            if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
                echo -e "    ${YELLOW}⚠${NC} ~/.local/bin not in PATH. Add to your shell profile."
                echo "        export PATH=\"\$HOME/.local/bin:\$PATH\""
            fi
        fi
    fi
fi

# ── 3. Git identity ──────────────────────────────────────────────────────
echo
echo "--- Git ---"
check "git available" "command -v git" fail "nix-shell -p git"

if command -v git &>/dev/null; then
    user_name=$(git config --global user.name 2>/dev/null || echo "")
    user_email=$(git config --global user.email 2>/dev/null || echo "")
    
    if [[ -z "$user_name" ]]; then
        echo -e "  ${RED}✗${NC} git user.name not configured"
        echo -e "    ${YELLOW}→${NC} Commits will fail. Set: git config --global user.name \"Your Name\""
        issues=$((issues + 1))
    else
        echo -e "  ${GREEN}✓${NC} git user.name = $user_name"
    fi
    
    if [[ -z "$user_email" ]]; then
        echo -e "  ${RED}✗${NC} git user.email not configured"
        echo -e "    ${YELLOW}→${NC} Commits will fail. Set: git config --global user.email \"you@example.com\""
        issues=$((issues + 1))
    else
        echo -e "  ${GREEN}✓${NC} git user.email = $user_email"
    fi
fi

# ── 4. Common Pi tooling ──────────────────────────────────────────────────
echo
echo "--- Pi Tooling ---"

check "ripgrep (rg)" "command -v rg" warn \
    "nix-shell -p ripgrep"
check "jq (JSON processor)" "command -v jq" warn \
    "nix-shell -p jq"
check "nix-shell (for one-off deps)" "command -v nix-shell" warn \
    "This is a NixOS system — nix-shell should be available."

# ── 5. Sudo / permissions ──────────────────────────────────────────────────
echo
echo "--- Permissions ---"

if command -v sudo &>/dev/null; then
    # Check if sudo can be used without a TTY
    if sudo -n true &>/dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} sudo available (NOPASSWD, no TTY required)"
    else
        echo -e "  ${YELLOW}⚠${NC} sudo may require a TTY or password"
        echo -e "    ${YELLOW}→${NC} Pi agents run headless — sudo without NOPASSWD will fail."
        echo "    Add to sudoers:  $USER ALL=(root) NOPASSWD: ALL"
    fi
else
    echo -e "  ${YELLOW}⚠${NC} sudo not available"
fi

# ── 6. File system writability ────────────────────────────────────────────
echo
echo "--- Filesystem ---"
cwd=$(pwd)
if [[ -w "$cwd" ]]; then
    echo -e "  ${GREEN}✓${NC} Current directory is writable"
else
    echo -e "  ${RED}✗${NC} Current directory is NOT writable"
    issues=$((issues + 1))
fi

# Check for Nix store paths in PATH (common source of spawn ENOENT)
echo
echo "--- PATH sanity ---"
path_issues=0
IFS=':' read -ra PATH_DIRS <<< "$PATH"
for d in "${PATH_DIRS[@]}"; do
    if [[ ! -d "$d" ]]; then
        path_issues=$((path_issues + 1))
    fi
done
if [[ $path_issues -gt 0 ]]; then
    echo -e "  ${YELLOW}⚠${NC} $path_issues PATH entries point to non-existent directories"
else
    echo -e "  ${GREEN}✓${NC} All PATH entries exist"
fi

# ── SUMMARY ────────────────────────────────────────────────────────────────
echo
echo "════════════════════════════════════════════════════════════════"
if [[ $issues -ge 100 ]]; then
    echo -e "${RED}FATAL: sh not available — bash tool will not work.${NC}"
    echo "Fix: ensure bash is in PATH (nix-shell -p bash)"
elif [[ $issues -gt 0 ]]; then
    echo -e "${YELLOW}WARNING: $issues issue(s) detected.${NC}"
    echo "Re-run with --fix to auto-remediate some issues."
else
    echo -e "${GREEN}All checks passed. Happy coding!${NC}"
fi
if [[ $fixes -gt 0 ]]; then
    echo -e "${GREEN}$fixes issue(s) auto-fixed.${NC}"
fi
echo "════════════════════════════════════════════════════════════════"

exit $(( issues < 100 ? 0 : 1 ))
