import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = PROJECT_ROOT / "src"
sys.path.insert(0, str(SRC_ROOT))

from copilot_lint_fixer.copilot_client import extract_updated_file


def test_extract_updated_file_from_json():
    response = '{"updated_file": "print(123)\\n"}'
    assert extract_updated_file(response) == "print(123)\n"


def test_extract_updated_file_from_wrapped_json():
    response = "Here is your fix:\n{\"updated_file\": \"x = 1\\n\"}\nThanks!"
    assert extract_updated_file(response) == "x = 1\n"


def test_extract_updated_file_missing():
    response = "no json here"
    assert extract_updated_file(response) is None
