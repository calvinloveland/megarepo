from __future__ import annotations

import re
import unicodedata

_UNICODE_REPLACEMENTS = {
    "ﬁ": "fi",
    "ﬂ": "fl",
    "ﬀ": "ff",
    "ﬃ": "ffi",
    "ﬄ": "ffl",
    "’": "'",
    "‘": "'",
    "“": '"',
    "”": '"',
    "—": "-",
    "–": "-",
    "…": "...",
}

_PAGE_NUMBER_LINE = re.compile(r"^[\s\divxlcdmIVXLCDM\-\.\[\]\(\)]{1,12}$")
_LINE_ART_LINE = re.compile(r"^[\s\\/_|+=*#~`^]{3,}$")
_BROKEN_HYPHEN = re.compile(r"([A-Za-z])-\n([a-z])")


def cleanup_ocr_text(text: str) -> str:
    cleaned = text.replace("\r\n", "\n").replace("\r", "\n").replace("\f", "\n")
    cleaned = unicodedata.normalize("NFKC", cleaned)
    for original, replacement in _UNICODE_REPLACEMENTS.items():
        cleaned = cleaned.replace(original, replacement)

    cleaned = _BROKEN_HYPHEN.sub(r"\1\2", cleaned)
    cleaned_lines: list[str] = []
    for line in cleaned.splitlines():
        stripped = line.strip()
        if not stripped:
            cleaned_lines.append("")
            continue
        if _PAGE_NUMBER_LINE.fullmatch(stripped):
            continue
        if _LINE_ART_LINE.fullmatch(stripped):
            continue
        cleaned_lines.append(stripped)

    cleaned = "\n".join(cleaned_lines)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    return cleaned.strip()
