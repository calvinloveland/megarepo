"""Small syntax-highlighting helpers for Code Reviewdle."""

from __future__ import annotations

from dataclasses import dataclass
from html import escape

from markupsafe import Markup

COMMON_KEYWORDS = {
    "return",
    "if",
    "else",
    "for",
    "while",
    "break",
    "continue",
    "switch",
    "case",
    "default",
    "try",
    "catch",
    "finally",
    "throw",
    "class",
    "struct",
    "public",
    "private",
    "protected",
    "static",
    "const",
    "let",
    "var",
    "function",
    "def",
    "async",
    "await",
    "new",
    "import",
    "from",
    "export",
    "package",
    "extends",
    "implements",
    "interface",
    "void",
    "int",
    "short",
    "double",
    "float",
    "bool",
    "boolean",
    "string",
    "mapping",
    "pragma",
    "contract",
    "event",
    "external",
    "view",
    "payable",
    "require",
    "true",
    "false",
    "null",
    "None",
    "goto",
}

TYPE_NAMES = {
    "ServerHello",
    "HashContext",
    "SignedParams",
    "ByteBuffer",
    "CommunityVault",
    "GuidancePacketBuilder",
}


@dataclass(frozen=True)
class HighlightedLine:
    """Rendered code line with minimal syntax classification."""

    number: int
    raw_text: str
    html: Markup


@dataclass(frozen=True)
class _Token:
    text: str
    token_type: str


def render_code_lines(language: str, code_lines: tuple[str, ...]) -> tuple[HighlightedLine, ...]:
    return tuple(
        HighlightedLine(number=index, raw_text=line, html=_render_line(language, line))
        for index, line in enumerate(code_lines, start=1)
    )


def _render_line(language: str, line: str) -> Markup:
    rendered_tokens = []
    for token in _tokenize_line(language, line):
        if token.token_type == "plain":
            rendered_tokens.append(escape(token.text))
        else:
            rendered_tokens.append(
                f'<span class="tok-{token.token_type}">{escape(token.text)}</span>'
            )
    if not rendered_tokens:
        return Markup(" ")
    return Markup("".join(rendered_tokens))


def _tokenize_line(language: str, line: str) -> list[_Token]:
    comment_start = _comment_start(language, line)
    if comment_start is None:
        return _scan_plain_tokens(line)
    return _scan_plain_tokens(line[:comment_start]) + [_Token(line[comment_start:], "comment")]


def _comment_start(language: str, line: str) -> int | None:
    in_string = False
    string_quote = ""
    index = 0
    while index < len(line):
        char = line[index]
        if in_string:
            if char == string_quote and line[index - 1] != "\\":
                in_string = False
            index += 1
            continue
        if char in {"'", '"'}:
            in_string = True
            string_quote = char
            index += 1
            continue
        if language.lower() == "python" and char == "#":
            return index
        if index + 1 < len(line) and line[index:index + 2] == "//":
            return index
        index += 1
    return None


def _scan_plain_tokens(text: str) -> list[_Token]:
    tokens: list[_Token] = []
    index = 0
    while index < len(text):
        char = text[index]
        if char.isspace():
            start_index = index
            while index < len(text) and text[index].isspace():
                index += 1
            tokens.append(_Token(text[start_index:index], "plain"))
            continue
        if char in {"'", '"'}:
            tokens.append(_Token(*_consume_string(text, index)))
            index = _consume_string_end(text, index)
            continue
        if char.isdigit():
            start_index = index
            while index < len(text) and (text[index].isdigit() or text[index] in {".", "x"}):
                index += 1
            tokens.append(_Token(text[start_index:index], "number"))
            continue
        if char.isalpha() or char == "_":
            start_index = index
            while index < len(text) and (text[index].isalnum() or text[index] == "_"):
                index += 1
            word = text[start_index:index]
            token_type = _word_type(word, text, index)
            tokens.append(_Token(word, token_type))
            continue
        if char in "{}[]()":
            tokens.append(_Token(char, "brace"))
        elif char in ",;":
            tokens.append(_Token(char, "muted"))
        else:
            tokens.append(_Token(char, "operator"))
        index += 1
    return tokens


def _consume_string(text: str, start_index: int) -> tuple[str, str]:
    end_index = _consume_string_end(text, start_index)
    return text[start_index:end_index], "string"


def _consume_string_end(text: str, start_index: int) -> int:
    quote = text[start_index]
    index = start_index + 1
    while index < len(text):
        if text[index] == quote and text[index - 1] != "\\":
            return index + 1
        index += 1
    return len(text)


def _word_type(word: str, text: str, next_index: int) -> str:
    if word in COMMON_KEYWORDS:
        return "keyword"
    if word in TYPE_NAMES or (word[:1].isupper() and len(word) > 1):
        return "type"
    tail = text[next_index:]
    stripped_tail = tail.lstrip()
    if stripped_tail.startswith("("):
        return "function"
    return "identifier"
