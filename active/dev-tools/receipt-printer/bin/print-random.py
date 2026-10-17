#!/usr/bin/env python3
"""Print N characters of entropy from /dev/random.

Bytes are mapped onto a printable ASCII alphabet so the slip is legible.

Usage: print-random.py [count] [--alphabet 62|94|hex|b62]
"""

import sys
import time

PRINTER = "/dev/usb/lp0"
ESC = b"\x1b"
GS = b"\x1d"

ALPHABETS = {
    # digits + upper + lower: no punctuation, easiest to read out loud
    "62": b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
    # every printable ASCII glyph
    "94": bytes(range(33, 127)),
    "hex": b"0123456789abcdef",
}


def entropy(n: int, alphabet: bytes) -> str:
    """Rejection-sample uniform indices so characters aren't modulo-biased."""
    limit = 256 - (256 % len(alphabet))  # largest multiple of alphabet size
    chars = []
    with open("/dev/random", "rb", buffering=0) as rnd:
        while len(chars) < n:
            for b in rnd.read(256):
                if b < limit:
                    chars.append(alphabet[b % len(alphabet)])
                    if len(chars) == n:
                        break
    return "".join(chr(c) for c in chars)


def main() -> None:
    positional = [a for a in sys.argv[1:] if not a.startswith("--")]
    count = int(positional[0]) if positional else 100

    name = "62"
    if "--alphabet" in sys.argv:
        name = sys.argv[sys.argv.index("--alphabet") + 1]
    alphabet = ALPHABETS[name]

    text = entropy(count, alphabet)

    lines = [text[i : i + 32] for i in range(0, len(text), 32)]

    out = bytearray()
    out += ESC + b"@"
    out += ESC + b"a" + b"\x00"
    out += f"/dev/random  {count} chars\n".encode()
    out += b"-" * 32 + b"\n"
    for line in lines:
        out += line.encode("ascii") + b"\n"
    out += b"\n" + ESC + b"d\x04"
    out += GS + b"V" + b"\x42" + b"\x00"  # feed + partial cut

    with open(PRINTER, "wb", buffering=0) as f:
        f.write(bytes(out))

    print(text)


if __name__ == "__main__":
    main()
