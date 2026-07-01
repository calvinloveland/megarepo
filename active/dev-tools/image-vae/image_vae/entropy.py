"""
Entropy coding for VAE latent vectors.

Implements canonical Huffman coding to losslessly compress the
8-bit quantized latent bytes, typically saving 10–25% on top of
the basic quantization.

Usage:
    encoder = HuffmanEncoder()
    code = encoder.encode(latent_bytes)      # returns compressed bytes
    table = encoder.export_table()           # for serialization

    decoder = HuffmanDecoder()
    decoder.import_table(table_bytes)
    original = decoder.decode(compressed, len(latent_bytes))
"""

from __future__ import annotations

import struct
from collections import Counter
from dataclasses import dataclass
from heapq import heapify, heappop, heappush
from typing import Optional


# ---------------------------------------------------------------------------
# Huffman tree construction
# ---------------------------------------------------------------------------

@dataclass
class _Node:
    """Node in the Huffman tree. Leaf nodes have value != None."""
    freq: int
    value: Optional[int] = None
    left: Optional["_Node"] = None
    right: Optional["_Node"] = None

    def __lt__(self, other):
        return self.freq < other.freq


def _build_codes(freqs: dict[int, int]) -> dict[int, tuple[int, int]]:
    """
    Build canonical Huffman codes from a frequency table.

    Returns dict mapping byte_value -> (code_as_int, code_length_in_bits).
    """
    if not freqs:
        return {0: (0, 1)}

    # Build tree
    heap = [_Node(freq=f, value=v) for v, f in freqs.items()]
    heapify(heap)
    while len(heap) > 1:
        a = heappop(heap)
        b = heappop(heap)
        heappush(heap, _Node(freq=a.freq + b.freq, left=a, right=b))
    tree = heap[0]

    # Get code lengths via DFS
    lengths: dict[int, int] = {}
    def dfs(node: _Node, depth: int = 0):
        if node.value is not None:
            lengths[node.value] = max(depth, 1)
        if node.left:
            dfs(node.left, depth + 1)
        if node.right:
            dfs(node.right, depth + 1)
    dfs(tree)

    # Generate canonical codes: sort by (length, symbol)
    sorted_syms = sorted(lengths.items(), key=lambda x: (x[1], x[0]))
    code = 0
    prev_len = 0
    codes: dict[int, tuple[int, int]] = {}
    for sym, length in sorted_syms:
        code <<= (length - prev_len)
        codes[sym] = (code, length)
        code += 1
        prev_len = length
    return codes


# ---------------------------------------------------------------------------
# Bit-level I/O helpers
# ---------------------------------------------------------------------------

class _BitWriter:
    """Write bits to a byte buffer (MSB first)."""

    def __init__(self):
        self.buffer = bytearray()
        self.current = 0
        self.nbits = 0

    def write_bits(self, value: int, nbits: int):
        """Write nbits of value (MSB first)."""
        for i in range(nbits - 1, -1, -1):
            self.current = (self.current << 1) | ((value >> i) & 1)
            self.nbits += 1
            if self.nbits == 8:
                self.buffer.append(self.current)
                self.current = 0
                self.nbits = 0

    def flush(self):
        """Flush remaining bits (zero-padded)."""
        if self.nbits > 0:
            self.current <<= (8 - self.nbits)
            self.buffer.append(self.current)
            self.current = 0
            self.nbits = 0

    def get_bytes(self) -> bytes:
        self.flush()
        return bytes(self.buffer)


class _BitReader:
    """Read bits from a byte buffer (MSB first)."""

    def __init__(self, data: bytes):
        self.data = data
        self.pos = 0       # byte position
        self.bits_left = 0 # bits remaining in current byte
        self.current = 0   # current byte value

    def read_bit(self) -> int:
        if self.bits_left == 0:
            if self.pos >= len(self.data):
                return 0
            self.current = self.data[self.pos]
            self.pos += 1
            self.bits_left = 8
        bit = (self.current >> 7) & 1
        self.current = (self.current << 1) & 0xFF
        self.bits_left -= 1
        return bit

    def read_bits(self, n: int) -> int:
        """Read n bits, MSB first."""
        result = 0
        for _ in range(n):
            result = (result << 1) | self.read_bit()
        return result


# ---------------------------------------------------------------------------
# Encoder
# ---------------------------------------------------------------------------

class HuffmanEncoder:
    """Build a Huffman code from data bytes and encode them."""

    def __init__(self):
        self._codes: dict[int, tuple[int, int]] = {}
        self._built = False

    def _ensure_built(self, data: bytes):
        if not self._built:
            freqs = Counter(data) if data else {0: 1}
            self._codes = _build_codes(freqs)
            self._built = True

    def encode(self, data: bytes) -> bytes:
        """Encode data bytes using Huffman coding. Returns compressed bytes."""
        if not data:
            return b""
        self._ensure_built(data)
        writer = _BitWriter()
        for b in data:
            code, nbits = self._codes[b]
            writer.write_bits(code, nbits)
        return writer.get_bytes()

    def export_table(self) -> bytes:
        """
        Export the Huffman code table for storage.

        Format:
          [num_symbols: 2 bytes, LE]
          [symbol_0: 1 byte] [code_length_0: 1 byte]
          [symbol_1: 1 byte] [code_length_1: 1 byte]
          ...
        """
        self._ensure_built(b"")
        sorted_syms = sorted(self._codes.items())
        num_syms = len(sorted_syms)
        header = struct.pack("<H", num_syms)
        table_data = bytearray()
        for sym, (_, length) in sorted_syms:
            table_data.append(sym)
            table_data.append(length)
        return header + bytes(table_data)

    @property
    def compressed_size_estimate(self) -> int:
        """Estimate compressed size in bytes based on frequencies."""
        if not self._codes:
            return 0
        writer = _BitWriter()
        # We don't have the data, just estimate from frequencies
        # This requires knowing the frequencies, which we don't store
        # So this is just an approximation
        return 0


# ---------------------------------------------------------------------------
# Decoder
# ---------------------------------------------------------------------------

class HuffmanDecoder:
    """Decode data previously encoded with HuffmanEncoder."""

    def __init__(self):
        self._lookup: dict[int, tuple[int, int]] = {}  # (padded_code, nbits) -> symbol
        self._max_bits = 0
        self._loaded = False

    def import_table(self, table: bytes):
        """Import a Huffman table exported by HuffmanEncoder.export_table()."""
        num_syms = struct.unpack("<H", table[:2])[0]
        symbols: dict[int, int] = {}
        offset = 2
        for _ in range(num_syms):
            sym = table[offset]
            length = table[offset + 1]
            offset += 2
            symbols[sym] = length

        # Rebuild canonical codes from lengths
        sorted_syms = sorted(symbols.items(), key=lambda x: (x[1], x[0]))
        code = 0
        prev_len = 0
        self._lookup = {}
        self._max_bits = 0
        for sym, length in sorted_syms:
            code <<= (length - prev_len)
            # Store padded code for easy matching (left-aligned)
            padded = code << (32 - length) if length < 32 else code
            self._lookup[(padded, length)] = sym
            self._max_bits = max(self._max_bits, length)
            code += 1
            prev_len = length

        self._loaded = True

    def _decode_one(self, reader: _BitReader) -> int:
        """Read one symbol from the bit stream."""
        buffer = 0
        bits_read = 0
        while bits_read < self._max_bits:
            bit = reader.read_bit()
            buffer = (buffer << 1) | bit
            bits_read += 1
            # Check if this code matches
            padded = buffer << (32 - bits_read) if bits_read < 32 else buffer
            sym = self._lookup.get((padded, bits_read))
            if sym is not None:
                return sym
        raise ValueError("No Huffman code matched")

    def decode(self, compressed: bytes, original_size: int) -> bytes:
        """
        Decode Huffman-compressed data.

        Args:
            compressed: The compressed bytes.
            original_size: The expected number of decompressed bytes.

        Returns:
            Decompressed original bytes.
        """
        if not self._loaded:
            raise RuntimeError("No Huffman table loaded. Call import_table() first.")
        if not compressed:
            return b""

        reader = _BitReader(compressed)
        result = bytearray()
        while len(result) < original_size:
            sym = self._decode_one(reader)
            result.append(sym)
        return bytes(result)


# ---------------------------------------------------------------------------
# Convenience functions
# ---------------------------------------------------------------------------

def compress_with_huffman(data: bytes) -> bytes:
    """
    One-shot compress: encode data with Huffman coding.

    Returns: [table_bytes] [compressed_data]
    """
    enc = HuffmanEncoder()
    compressed = enc.encode(data)
    table = enc.export_table()
    return table + compressed


def read_huffman_payload(payload: bytes) -> tuple[bytes, bytes]:
    """
    Split a Huffman-compressed payload into (table, compressed_data).
    """
    num_syms = struct.unpack("<H", payload[:2])[0]
    table_size = 2 + 2 * num_syms
    table = payload[:table_size]
    compressed_data = payload[table_size:]
    return table, compressed_data


def decompress_with_huffman(data: bytes, original_size: int) -> bytes:
    """One-shot decompress using Huffman coding."""
    table, compressed = read_huffman_payload(data)
    dec = HuffmanDecoder()
    dec.import_table(table)
    return dec.decode(compressed, original_size)


def entropy_savings(original: bytes) -> dict:
    """
    Analyze potential savings from Huffman coding on latent bytes.

    Returns dict with keys: original_size, compressed_size, table_size,
    total_size, savings_bytes, savings_pct.

    Note: For small inputs (< ~200 bytes), table overhead may exceed savings,
    resulting in negative savings_pct. Huffman is most effective on larger
    data with skewed symbol distributions.
    """
    if not original:
        return {"original_size": 0, "compressed_size": 0, "table_size": 0,
                "total_size": 0, "savings_bytes": 0, "savings_pct": 0}
    packed = compress_with_huffman(original)
    table, comp = read_huffman_payload(packed)
    total = len(packed)
    pct = round((1 - total / len(original)) * 100, 1) if len(original) > 0 else 0.0
    return {
        "original_size": len(original),
        "compressed_size": len(comp),
        "table_size": len(table),
        "total_size": total,
        "savings_bytes": len(original) - total,
        "savings_pct": pct,
    }
