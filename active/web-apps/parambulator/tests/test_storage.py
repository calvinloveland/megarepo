import json

import pytest

from parambulator.storage import list_saves, load_payload, save_payload, storage_dir


def test_save_payload_writes_json_with_saved_at(tmp_path):
    payload = {"rows": 4, "cols": 5, "design": "design_2"}
    save_path = save_payload(tmp_path, "My Save!?", payload)

    assert save_path.name == "MySave.json"
    saved = json.loads(save_path.read_text(encoding="utf-8"))
    assert saved["rows"] == 4
    assert saved["cols"] == 5
    assert saved["design"] == "design_2"
    assert "saved_at" in saved


def test_save_and_list_saves_are_sanitized_and_sorted(tmp_path):
    save_payload(tmp_path, "z-last", {"v": 1})
    long_name = "a" * 80
    truncated = "a" * 60
    save_payload(tmp_path, long_name, {"v": 2})

    assert list_saves(tmp_path) == [truncated, "z-last"]


def test_load_payload_returns_saved_data(tmp_path):
    save_payload(tmp_path, "classroom", {"layout_map": "XX\nXX"})

    loaded = load_payload(tmp_path, "classroom")

    assert loaded["layout_map"] == "XX\nXX"
    assert "saved_at" in loaded


def test_storage_validation_errors(tmp_path):
    with pytest.raises(ValueError, match="Invalid save name"):
        save_payload(tmp_path, "", {"x": 1})

    with pytest.raises(ValueError, match="Save name must contain at least one valid character"):
        save_payload(tmp_path, "!!!", {"x": 1})

    with pytest.raises(ValueError, match="Invalid save name"):
        load_payload(tmp_path, "")

    with pytest.raises(FileNotFoundError, match="Save 'missing' not found."):
        load_payload(tmp_path, "missing")

    assert storage_dir(tmp_path).exists()
