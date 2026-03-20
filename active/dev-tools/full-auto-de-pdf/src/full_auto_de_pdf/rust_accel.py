from __future__ import annotations

import ctypes
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Sequence

_RUST_ACCEL_ENV = "FULL_AUTO_DE_PDF_RUST_ACCEL_LIB"


@dataclass(frozen=True)
class RustInverseRenderAccel:
    path: Path
    _score_func: object

    def best_iou_score(self, observed: bytes, candidates: Sequence[bytes]) -> tuple[int, float]:
        if not candidates:
            raise ValueError("candidates must not be empty")
        image_len = len(observed)
        if image_len == 0:
            raise ValueError("observed image must not be empty")
        for candidate in candidates:
            if len(candidate) != image_len:
                raise ValueError("candidate image bytes must match observed image length")
        observed_buffer = (ctypes.c_uint8 * image_len).from_buffer_copy(observed)
        candidate_blob = b"".join(candidates)
        candidate_buffer = (ctypes.c_uint8 * len(candidate_blob)).from_buffer_copy(candidate_blob)
        best_index = ctypes.c_size_t()
        best_score = ctypes.c_double()
        status = self._score_func(
            observed_buffer,
            image_len,
            candidate_buffer,
            len(candidates),
            ctypes.byref(best_index),
            ctypes.byref(best_score),
        )
        if status != 0:
            raise RuntimeError(f"Rust inverse-render accelerator failed with status {status}")
        return int(best_index.value), float(best_score.value)


@lru_cache(maxsize=1)
def get_rust_inverse_render_accel() -> RustInverseRenderAccel | None:
    lib_path_text = os.environ.get(_RUST_ACCEL_ENV)
    if lib_path_text is None or not lib_path_text.strip():
        return None
    lib_path = Path(lib_path_text).expanduser()
    if not lib_path.is_file():
        raise RuntimeError(
            f"Rust inverse-render accelerator library {lib_path} from {_RUST_ACCEL_ENV} was not found"
        )
    library = ctypes.CDLL(str(lib_path))
    score_func = library.full_auto_de_pdf_best_iou_score_u8
    score_func.argtypes = [
        ctypes.POINTER(ctypes.c_uint8),
        ctypes.c_size_t,
        ctypes.POINTER(ctypes.c_uint8),
        ctypes.c_size_t,
        ctypes.POINTER(ctypes.c_size_t),
        ctypes.POINTER(ctypes.c_double),
    ]
    score_func.restype = ctypes.c_int
    return RustInverseRenderAccel(path=lib_path, _score_func=score_func)
