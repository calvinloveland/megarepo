#!/usr/bin/env bash

# Master test runner for Calvin's NixOS Configuration
# Runs all available tests and provides a comprehensive report

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Test results tracking
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
HOSTS=()

log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

run_test_suite() {
    local test_name="$1"
    local test_command="$2"
    local test_dir="$3"
    
    echo -e "\n${YELLOW}🧪 Running: $test_name${NC}"
    echo "----------------------------------------"
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    local original_dir
    original_dir=$(pwd)
    if [ -n "$test_dir" ]; then
        cd "$test_dir"
    fi
    
    if eval "$test_command"; then
        log_success "$test_name completed successfully"
        PASSED_TESTS=$((PASSED_TESTS + 1))
        cd "$original_dir"
        return 0
    else
        log_error "$test_name failed"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        cd "$original_dir"
        return 1
    fi
}

discover_hosts() {
    HOSTS=()
    local hosts_dir="$PROJECT_ROOT/hosts"
    if [ -d "$hosts_dir" ]; then
        for dir in "$hosts_dir"/*; do
            [ -d "$dir" ] || continue
            HOSTS+=("$(basename "$dir")")
        done
    fi
}

# Main test execution
main() {
    echo -e "${BLUE}🚀 Calvin's NixOS Configuration Test Suite${NC}"
    echo "=========================================="
    echo "Running comprehensive tests for multi-host configuration"
    echo
    
    # Navigate to project root
    PROJECT_ROOT="$(dirname "$0")/.."
    cd "$PROJECT_ROOT"
    PROJECT_ROOT=$(pwd)  # Get absolute path
    discover_hosts
    
    # 1. Configuration validation
    run_test_suite "Configuration Validation" "python3 tests/validate_config.py" ""
    
    # 2. Rebuild script tests
    run_test_suite "Rebuild Script Tests" "./test_rebuild.sh" "tests"
    
    # 3. Nix flake checks (if available)
    if command -v nix >/dev/null 2>&1; then
        # Use the main project flake, not the tests flake
        run_test_suite "Nix Flake Check" "nix flake check --no-build ." ""
        
        if [ ${#HOSTS[@]} -eq 0 ]; then
            log_warning "No host directories found; skipping build checks"
        else
            for host in "${HOSTS[@]}"; do
                run_test_suite "${host} Build Check" "nix build .#nixosConfigurations.${host}.config.system.build.toplevel --dry-run" ""
            done
        fi
    else
        log_warning "Nix command not available, skipping flake checks"
    fi
    
    # 5. Code quality checks (if tools available)
    if command -v statix >/dev/null 2>&1; then
        run_test_suite "Nix Code Linting" "statix check ." ""
    else
        log_info "statix not available, skipping linting"
    fi
    
    if command -v deadnix >/dev/null 2>&1; then
        run_test_suite "Dead Code Detection" "deadnix ." ""
    else
        log_info "deadnix not available, skipping dead code detection"
    fi
    
    # 6. Security checks
    run_test_suite "File Permissions Check" "find . -name '*.sh' -not -perm -u+x | wc -l | grep -q '^0$'" ""
    
    # Test summary
    echo
    echo -e "${BLUE}📊 Test Summary${NC}"
    echo "=============="
    echo "Total test suites: $TOTAL_TESTS"
    echo "Passed: $PASSED_TESTS"
    echo "Failed: $FAILED_TESTS"
    
    if [ $FAILED_TESTS -eq 0 ]; then
        echo -e "\n${GREEN}🎉 All tests passed! Your configuration is ready.${NC}"
        echo -e "${GREEN}You can safely run: ./rebuild.sh${NC}"
        exit 0
    else
        echo -e "\n${RED}💥 $FAILED_TESTS test suite(s) failed!${NC}"
        echo -e "${RED}Please fix the issues before deploying.${NC}"
        exit 1
    fi
}

# Help function
show_help() {
    echo "Usage: $0 [OPTIONS]"
    echo
    echo "Options:"
    echo "  -h, --help     Show this help message"
    echo "  --quick        Run only fast tests (skip build checks)"
    echo "  --lint-only    Run only code quality checks"
    echo
    echo "Examples:"
    echo "  $0                 # Run all tests"
    echo "  $0 --quick         # Quick validation only"
    echo "  $0 --lint-only     # Code quality only"
}

# Parse arguments
case "${1:-}" in
    -h|--help)
        show_help
        exit 0
        ;;
    --quick)
        log_info "Running quick tests only..."
        # Override main function for quick tests
        main() {
            cd "$(dirname "$0")/.."
            run_test_suite "Configuration Validation" "python3 tests/validate_config.py" ""
            run_test_suite "Rebuild Script Tests" "./test_rebuild.sh" "tests"
            echo -e "\n${GREEN}✅ Quick tests completed${NC}"
        }
        ;;
    --lint-only)
        log_info "Running code quality checks only..."
        main() {
            cd "$(dirname "$0")/.."
            if command -v statix >/dev/null 2>&1; then
                run_test_suite "Nix Code Linting" "statix check ." ""
            fi
            if command -v deadnix >/dev/null 2>&1; then
                run_test_suite "Dead Code Detection" "deadnix ." ""
            fi
            echo -e "\n${GREEN}✅ Code quality checks completed${NC}"
        }
        ;;
esac

main "$@"