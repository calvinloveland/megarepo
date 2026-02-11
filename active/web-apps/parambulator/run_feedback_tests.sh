#!/usr/bin/env bash
# Run feedback improvement tests with proper setup

set -e

cd "$(dirname "$0")"

echo "=== Running Feedback Improvement Tests ==="
echo

# Check if we're in a virtual environment
if [ -z "$VIRTUAL_ENV" ]; then
    echo "⚠️  Warning: No virtual environment detected"
    echo "   Consider running: python -m venv .venv && source .venv/bin/activate"
    echo
fi

# Check for required dependencies
echo "Checking dependencies..."
python -c "import playwright" 2>/dev/null || {
    echo "❌ Playwright not installed"
    echo "   Run: pip install playwright"
    exit 1
}

python -c "import pytest" 2>/dev/null || {
    echo "❌ pytest not installed"
    echo "   Run: pip install pytest"
    exit 1
}

# Check if Playwright browsers are installed
if [ ! -d "${PLAYWRIGHT_BROWSERS_PATH:-.playwright_browsers}" ]; then
    echo "❌ Playwright browsers not installed"
    echo "   Run: npx playwright install chromium"
    exit 1
fi

echo "✓ Dependencies OK"
echo

# Run the tests
echo "Running test suite..."
echo

export FLASK_DEBUG=true
pytest tests/test_feedback_improvements.py -v --tb=short "$@"

exit_code=$?

if [ $exit_code -eq 0 ]; then
    echo
    echo "✅ All tests passed!"
else
    echo
    echo "❌ Some tests failed (exit code: $exit_code)"
fi

exit $exit_code
