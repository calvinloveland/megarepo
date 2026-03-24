#!/usr/bin/env bash

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

TESTS_RUN=0
TESTS_PASSED=0

run_test() {
    local test_name="$1"
    local test_command="$2"

    echo -e "${YELLOW}🧪 Running: $test_name${NC}"
    TESTS_RUN=$((TESTS_RUN + 1))

    if eval "$test_command"; then
        echo -e "${GREEN}✅ PASS: $test_name${NC}"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo -e "${RED}❌ FAIL: $test_name${NC}"
    fi
    echo
}

test_thinker_hostname() {
    python3 - <<'PY'
import importlib.util
from pathlib import Path
from unittest.mock import patch

rebuild_path = (Path.cwd().parent / "rebuild.py").resolve()
spec = importlib.util.spec_from_file_location("rebuild_py", rebuild_path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

with patch.object(mod.shutil, "which", return_value="/usr/bin/hostname"), \
     patch.object(mod.subprocess, "check_output", return_value=b"Thinker\n"):
    assert mod.detect_host() == "thinker"
PY
}

test_fallback_detection() {
    python3 - <<'PY'
import importlib.util
from pathlib import Path
from unittest.mock import patch

rebuild_path = (Path.cwd().parent / "rebuild.py").resolve()
spec = importlib.util.spec_from_file_location("rebuild_py", rebuild_path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

with patch.object(mod.shutil, "which", return_value="/usr/bin/hostname"), \
     patch.object(mod.subprocess, "check_output", return_value=b"unknown-host\n"):
    assert mod.detect_host() == "thinker"
PY
}

test_script_syntax() {
    bash -n ../rebuild.sh
}

test_help_output() {
    local output
    output=$(bash ../rebuild.sh -h 2>&1 || true)
    [[ "$output" == *"usage:"* ]]
}

test_invalid_host_rejected() {
    local output
    output=$(bash ../rebuild.sh invalid-host 2>&1 || true)
    [[ "$output" == *"invalid choice"* ]]
}

main() {
    echo -e "${YELLOW}🚀 Starting NixOS Configuration Tests${NC}"
    echo "Testing rebuild script functionality..."
    echo

    run_test "Thinker Hostname Detection" test_thinker_hostname
    run_test "Fallback Detection" test_fallback_detection
    run_test "Script Syntax Check" test_script_syntax
    run_test "Help Output" test_help_output
    run_test "Invalid Host Rejected" test_invalid_host_rejected

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

main "$@"
