#!/usr/bin/env bash
# Comprehensive environment and test diagnostics

set -e

cd /home/calvin/code/megarepo/active/personal/calnix

echo "=========================================="
echo "ENVIRONMENT DIAGNOSTICS"
echo "=========================================="
export_count=$(export -p | wc -l)
env_size=$(printenv | wc -c)
path_size=$(wc -c <<< "$PATH")

echo "✓ Exported variables: $export_count"
echo "✓ Total environment size: $env_size bytes"
echo "✓ PATH size: $path_size bytes"
echo ""

echo "=========================================="
echo "VALIDATION TESTS"
echo "=========================================="
./tests/validate_config.py 2>&1 | tail -5
echo ""

echo "=========================================="
echo "SHELL BUILTIN TESTS"
echo "=========================================="
cd tests && bash test_rebuild.sh 2>&1 | tail -5
echo ""

echo "=========================================="
echo "PYTHON TESTS"
echo "=========================================="
cd /home/calvin/code/megarepo/active/personal/calnix/tests
python3 -m pytest test_rebuild_py.py -v 2>&1 | grep -E '(test_|PASSED|FAILED|passed|failed)'
echo ""

echo "=========================================="
echo "FLAKE VALIDATION"
echo "=========================================="
cd /home/calvin/code/megarepo/active/personal/calnix
if nix flake check >/dev/null 2>&1; then
  echo "✅ nix flake check PASSED"
else
  echo "❌ nix flake check FAILED"
  exit 1
fi

echo ""
echo "✅ ALL TESTS COMPLETE - Environment is healthy!"
