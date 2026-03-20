import struct

import pytest
from PIL import Image

import full_auto_de_pdf.rust_mvp as rust_mvp
from full_auto_de_pdf.rust_mvp import (
    InverseRenderCandidate,
    compare_pre_rendered_candidates_python,
    pack_rust_iou_payload,
    pack_rust_rotate_iou_payload,
    rotate_and_compare_candidates_python,
)


def _image(values: list[int], size: tuple[int, int]) -> Image.Image:
    image = Image.new("L", size, color=255)
    image.putdata(values)
    return image


def test_pack_rust_iou_payload_serializes_header_and_body() -> None:
    observed = _image([0, 255, 0, 255], (2, 2))
    candidate = InverseRenderCandidate(
        font_path=None,
        font_size=12,
        offset_x=0,
        offset_y=0,
        rotation=0.0,
        rendered=_image([255, 255, 255, 255], (2, 2)),
    )

    payload = pack_rust_iou_payload(observed, [candidate])

    assert struct.unpack("<IIII", payload[:16]) == (2, 2, 4, 1)
    assert payload[16:20] == bytes([0, 255, 0, 255])
    assert payload[20:24] == bytes([255, 255, 255, 255])


def test_pack_rust_iou_payload_rejects_size_mismatches() -> None:
    observed = _image([0, 255, 0, 255], (2, 2))
    candidate = InverseRenderCandidate(
        font_path=None,
        font_size=12,
        offset_x=0,
        offset_y=0,
        rotation=0.0,
        rendered=_image([255], (1, 1)),
    )

    with pytest.raises(ValueError, match="size did not match"):
        pack_rust_iou_payload(observed, [candidate])


def test_compare_pre_rendered_candidates_python_picks_best_candidate() -> None:
    observed = _image([0, 255, 0, 255], (2, 2))
    candidates = [
        InverseRenderCandidate(
            font_path=None,
            font_size=12,
            offset_x=0,
            offset_y=0,
            rotation=0.0,
            rendered=_image([0, 255, 255, 255], (2, 2)),
        ),
        InverseRenderCandidate(
            font_path=None,
            font_size=12,
            offset_x=0,
            offset_y=0,
            rotation=0.0,
            rendered=_image([0, 255, 0, 255], (2, 2)),
        ),
    ]

    best_index, best_score = compare_pre_rendered_candidates_python(observed, candidates, repeats=2)

    assert best_index == 1
    assert best_score == 1.0


def test_pack_rust_rotate_iou_payload_serializes_rotations() -> None:
    observed = _image([0, 255, 0, 255], (2, 2))
    candidate = InverseRenderCandidate(
        font_path=None,
        font_size=12,
        offset_x=0,
        offset_y=0,
        rotation=0.5,
        rendered=_image([255, 255, 255, 255], (2, 2)),
    )

    payload = pack_rust_rotate_iou_payload(observed, [candidate])

    assert struct.unpack("<IIII", payload[:16]) == (2, 2, 4, 1)
    assert payload[16:20] == bytes([0, 255, 0, 255])
    assert struct.unpack("<d", payload[20:28])[0] == 0.5
    assert payload[28:32] == bytes([255, 255, 255, 255])


def test_rotate_and_compare_candidates_python_uses_candidate_rotation() -> None:
    observed = object()

    class FakeImage:
        def __init__(self, name: str) -> None:
            self.name = name

        def rotate(self, rotation: float, *, resample, fillcolor):  # noqa: ANN001
            assert rotation == 180.0
            assert fillcolor == 255
            return FakeImage(f"{self.name}-rotated")

    candidates = [
        InverseRenderCandidate(
            font_path=None,
            font_size=12,
            offset_x=0,
            offset_y=0,
            rotation=0.0,
            rendered=FakeImage("plain"),
        ),
        InverseRenderCandidate(
            font_path=None,
            font_size=12,
            offset_x=0,
            offset_y=0,
            rotation=180.0,
            rendered=FakeImage("needs-rotation"),
        ),
    ]
    monkey_scores = {
        ("plain", id(observed)): 0.1,
        ("needs-rotation-rotated", id(observed)): 1.0,
    }

    def _fake_binary_ink_iou(observed_binary, rendered_binary):  # noqa: ANN001
        return monkey_scores.get((rendered_binary.name, id(observed_binary)), 0.0)

    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(rust_mvp, "_binary_ink_iou", _fake_binary_ink_iou)
    try:
        best_index, best_score = rotate_and_compare_candidates_python(observed, candidates, repeats=1)
    finally:
        monkeypatch.undo()

    assert best_index == 1
    assert best_score == 1.0
