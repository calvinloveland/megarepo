#!/usr/bin/env bash
# ==============================================================================
# pi-path-guard.sh — Validate paths before Pi tool calls
#
# Checks if a path is a directory (would cause EISDIR for read/write tools)
# and whether it exists. Designed to be called before read/write/edit operations.
#
# Usage:
#   pi-path-guard.sh check <path>          # Validates and prints warnings
#   pi-path-guard.sh exists <path>          # Exit 0 if exists, 1 if not
#   pi-path-guard.sh is-file <path>         # Exit 0 if file, 1 if dir/missing
#   pi-path-guard.sh is-dir <path>          # Exit 0 if dir, 1 if file/missing
#   pi-path-guard.sh resolve <glob>         # Resolve glob and output valid file paths
# ==============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

usage() {
    cat <<EOF
pi-path-guard.sh — Safe path validation for Pi tooling

Usage:
  pi-path-guard.sh check <path>        Validate and warn about path issues
  pi-path-guard.sh exists <path>       Exit 0 if path exists
  pi-path-guard.sh is-file <path>      Exit 0 if path is a regular file
  pi-path-guard.sh is-dir <path>       Exit 0 if path is a directory
  pi-path-guard.sh resolve <glob...>   Resolve glob(s), output file paths only

Examples:
  pi-path-guard.sh check /etc/nixos     # warns if this is a directory
  pi-path-guard.sh resolve ./src/**/*.py  # list all .py files
EOF
    exit 1
}

[[ $# -lt 2 ]] && usage

cmd="$1"
shift

case "$cmd" in
    check)
        path="$1"
        if [[ ! -e "$path" ]]; then
            echo -e "${RED}✗${NC} Path does not exist: $path"
            echo "HINT:pi-path-guard:not-found:$path"
            exit 1
        fi
        if [[ -d "$path" ]]; then
            echo -e "${YELLOW}⚠${NC} Path is a DIRECTORY (not a file): $path"
            echo "HINT:pi-path-guard:is-directory:$path"
            echo "  Pi's read/write/edit tools operate on files, not directories."
            echo "  Use bash 'ls $path' or 'find $path' instead of read."
            exit 2
        fi
        if [[ -f "$path" ]]; then
            if [[ -r "$path" ]]; then
                echo -e "${GREEN}✓${NC} Valid file (readable): $path"
                exit 0
            else
                echo -e "${YELLOW}⚠${NC} File exists but is NOT readable: $path"
                echo "HINT:pi-path-guard:not-readable:$path"
                exit 3
            fi
        fi
        echo -e "${YELLOW}⚠${NC} Path exists but is not a regular file: $path"
        echo "HINT:pi-path-guard:special-file:$path"
        exit 4
        ;;
    
    exists)
        [[ -e "$1" ]] && exit 0 || exit 1
        ;;
    
    is-file)
        [[ -f "$1" ]] && exit 0 || exit 1
        ;;
    
    is-dir)
        [[ -d "$1" ]] && exit 0 || exit 1
        ;;
    
    resolve)
        for pattern in "$@"; do
            # Use compgen for bash glob expansion, fall back to ls
            shopt -s nullglob 2>/dev/null || true
            for f in $pattern; do
                if [[ -f "$f" ]]; then
                    echo "$f"
                fi
            done
        done
        ;;
    
    *)
        usage
        ;;
esac
