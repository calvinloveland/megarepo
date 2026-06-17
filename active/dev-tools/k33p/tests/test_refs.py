"""Tests for refs and pointers."""

from __future__ import annotations

import pytest

from k33p.refs import Pointer, Ref, RefType, parse_ref_string


def test_parse_simple_ref() -> None:
    ref = parse_ref_string("src@deadbeef")
    assert ref.channel == "src"
    assert ref.value == "deadbeef"
    assert ref.subproject is None
    assert ref.ref_type == RefType.COMMIT


def test_parse_ref_with_subproject() -> None:
    ref = parse_ref_string("powder_play@src@deadbeef")
    assert ref.subproject == "powder_play"
    assert ref.channel == "src"
    assert ref.value == "deadbeef"


def test_parse_artifacts_ref() -> None:
    ref = parse_ref_string("artifacts@v1.2.3")
    assert ref.channel == "artifacts"
    assert ref.ref_type == RefType.TAG  # starts with v and has a dot


def test_parse_artifacts_manifest_ref() -> None:
    ref = parse_ref_string("artifacts@sha256:abc123")
    assert ref.channel == "artifacts"
    assert ref.ref_type == RefType.MANIFEST_ID


def test_parse_private_ref() -> None:
    ref = parse_ref_string("private@sha256:secret")
    assert ref.channel == "private"
    assert ref.ref_type == RefType.CONTENT_HASH


def test_parse_live_ref() -> None:
    ref = parse_ref_string("live@pointer-update-42")
    assert ref.channel == "live"
    assert ref.ref_type == RefType.POINTER


def test_parse_invalid_ref_raises() -> None:
    with pytest.raises(ValueError):
        parse_ref_string("nodelimiter")


def test_pointer_from_string() -> None:
    p = Pointer.from_dict("latest", "artifacts@v1.2.3")
    assert p.name == "latest"
    assert p.target.channel == "artifacts"
    assert p.target.value == "v1.2.3"


def test_pointer_from_mapping() -> None:
    p = Pointer.from_dict(
        "latest",
        {
            "target": "artifacts@v1.2.3",
            "reason": "release v1.2.3",
            "signature": {"key": "age1abc", "sig": "sig1xyz"},
        },
    )
    assert p.name == "latest"
    assert p.target.value == "v1.2.3"
    assert p.reason == "release v1.2.3"
    assert p.signature_key == "age1abc"
    assert p.signature_value == "sig1xyz"


def test_ref_str_representation() -> None:
    ref = Ref(channel="src", value="deadbeef", ref_type=RefType.COMMIT)
    assert str(ref) == "src@deadbeef"

    ref_sub = Ref(
        channel="src", value="deadbeef", ref_type=RefType.COMMIT, subproject="pp"
    )
    assert str(ref_sub) == "pp@src@deadbeef"
