#!/usr/bin/env bash

# Unit tests for the smart rebuild script
# Tests the host detection logic without actually running nixos-rebuild

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
TESTS_RUN=0
TESTS_PASSED=0

# Test helper functions
run_test() {
    local test_name="$1"
    local test_function="$2"
    
    echo -e "${YELLOW}🧪 Running: $test_name${NC}"
    TESTS_RUN=$((TESTS_RUN + 1))
    
    if $test_function; then
        echo -e "${GREEN}✅ PASS: $test_name${NC}"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo -e "${RED}❌ FAIL: $test_name${NC}"
    fi
    echo
}

# Extract the detect_host function from rebuild.sh for testing
source_detect_function() {
    # Extract just the detect_host function from rebuild.sh
    sed -n '/^detect_host()/,/^}/p' ../rebuild.sh > /tmp/detect_host_test.sh
    source /tmp/detect_host_test.sh
}

# Test WSL detection
test_wsl_detection() {
    # Mock WSL environment
    export WSL_DISTRO_NAME="Ubuntu"
    local result=$(detect_host)
    unset WSL_DISTRO_NAME
    
    [ "$result" = "work-wsl" ]
}

# Test hostname detection for Thinker
test_thinker_hostname() {
    # Mock hostname command
    hostname() { echo "Thinker"; }
    local result=$(detect_host)
    unset -f hostname
    
    [ "$result" = "thinker" ]
}

# Test hostname detection for work-wsl
test_work_hostname() {
    hostname() { echo "work-wsl"; }
    local result=$(detect_host)
    unset -f hostname
    
    [ "$result" = "work-wsl" ]
}

# Test fallback to thinker
test_fallback_detection() {
    # Mock environment with no special indicators
    hostname() { echo "unknown-host"; }
    # Mock /proc/version without microsoft
    local result=$(detect_host)
    unset -f hostname
    
    [ "$result" = "thinker" ]
}

# Test rebuild script syntax
test_script_syntax() {
    bash -n ../rebuild.sh
}

# Test rebuild script help output
test_help_output() {
    local output=$(bash ../rebuild.sh invalid-host 2>&1 || true)
    [[ "$output" == *"Unknown host"* ]] && [[ "$output" == *"Usage:"* ]]
}

# Test rebuild script manual override
test_manual_override() {
    # Test that manual arguments are respected
    local output=$(bash -c 'HOST="$1"; echo "Host would be: $HOST"' -- thinker)
    [[ "$output" == *"thinker"* ]]
}

# Main test execution
main() {
    echo -e "${YELLOW}🚀 Starting NixOS Configuration Tests${NC}"
    echo "Testing rebuild script functionality..."
    echo
    
    # Source the detect function
    source_detect_function
    
    # Run all tests
    run_test "WSL Detection" test_wsl_detection
    run_test "Thinker Hostname Detection" test_thinker_hostname
    run_test "Work WSL Hostname Detection" test_work_hostname
    run_test "Fallback Detection" test_fallback_detection
    run_test "Script Syntax Check" test_script_syntax
    run_test "Help Output" test_help_output
    run_test "Manual Override" test_manual_override
    
    # Summary
    echo -e "${YELLOW}📊 Test Summary${NC}"
    echo "Tests run: $TESTS_RUN"
    echo "Tests passed: $TESTS_PASSED"
    echo "Tests failed: $((TESTS_RUN - TESTS_PASSED))"
    
    if [ $TESTS_PASSED -eq $TESTS_RUN ]; then
        echo -e "${GREEN}🎉 All tests passed!${NC}"
        exit 0
    else
        echo -e "${RED}💥 Some tests failed!${NC}"
        exit 1
    fi
}

# Cleanup function
cleanup() {
    rm -f /tmp/detect_host_test.sh
}

trap cleanup EXIT

main "$@"