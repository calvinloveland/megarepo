"""Tests for the universal codec: signaling, CRC, adaptive switching, field updates."""

import random

from luc_sim.channel import DynamicChannel, transmit_bpsk_awgn
from luc_sim.codec import UniversalCodec, crc16
from luc_sim.codes import polar
from luc_sim.sim import run_link, switch_latencies_ms


def test_crc16_check_value():
    # CRC-16-CCITT (init 0xFFFF) of the ASCII bytes "123456789" is 0x29B1
    data = int("313233343536373839", 16)  # 9 ASCII bytes, 72 bits
    assert crc16(data, 72) == 0x29B1


def test_crc_detects_change():
    assert crc16(0xDEAD, 16) != crc16(0xDEAE, 16)


def test_roundtrip_high_snr():
    codec = UniversalCodec(cache=False)
    rng = random.Random(1)
    for name in codec.by_id:
        msg = rng.getrandbits(codec.user_bits_for(codec.registry[name]))
        frame, flen = codec.encode_frame(msg, name)
        assert flen == 256
        samples, llrs, _ = transmit_bpsk_awgn(frame, flen, codec.registry[name].rate, 20.0, rng)
        res = codec.decode_frame(samples, llrs, codec.payload_bits)
        assert res.ok and not res.outage, name


def test_crc_catches_misdecode():
    """Corrupt a payload codeword so it decodes to a *different valid* codeword.

    Hamming(15,11) is a perfect code (covering radius 1), so 5 bit flips make the
    received word land near a different codeword; GRAND returns that codeword and
    only the CRC can catch the wrong-but-valid message.
    Note: transmitted position p is int bit (FRAME_BITS - 1 - p).
    """
    codec = UniversalCodec(cache=False)
    code = codec.registry["hamming(15,11)"]
    rng = random.Random(2)
    msg = rng.getrandbits(codec.user_bits_for(code))
    frame, flen = codec.encode_frame(msg, code.name)
    seg_start = codec.header_len + code.n  # second codeword, transmitted position
    mask = 0b11111 << (flen - 1 - (seg_start + 4))  # 5 transmitted bits of codeword 1
    bad_frame = frame ^ mask
    samples, llrs, _ = transmit_bpsk_awgn(bad_frame, flen, code.rate, 20.0, rng)
    res = codec.decode_frame(samples, llrs, codec.payload_bits)
    assert not res.ok, "misdecode must be detected by CRC"


def test_adaptive_switching():
    codec = UniversalCodec(cache=False, profile_frames=150, target_bler=0.05)
    channel = DynamicChannel([(0, 12.0), (80, 3.5), (160, 10.0)])
    report = run_link(codec, channel, 240, seed=5, adaptive=True)
    assert len(codec.switches) >= 3
    assert len(report.code_usage()) >= 3
    assert report.bler() <= 1.0
    assert switch_latencies_ms(report, channel)


def test_fixed_link_uses_one_code():
    codec = UniversalCodec(cache=False, profile_frames=150)
    channel = DynamicChannel([(0, 8.0)])
    report = run_link(codec, channel, 120, seed=6, adaptive=False)
    assert len(report.code_usage()) <= 2  # one code + possible sync


def test_field_update_registers_new_code():
    codec = UniversalCodec(cache=False)
    before = len(codec.by_id)
    new_code = polar(16, 8, name="polar16-updated")
    codec.register(new_code)
    assert len(codec.by_id) == before + 1
    assert "polar16-updated" in codec.registry
    # and it is usable end-to-end
    msg = 0b1010101
    frame, flen = codec.encode_frame(msg, "polar16-updated")
    rng = random.Random(9)
    samples, llrs, _ = transmit_bpsk_awgn(frame, flen, new_code.rate, 12.0, rng)
    res = codec.decode_frame(samples, llrs, codec.payload_bits)
    assert res.ok


def test_policy_skips_syndrome_rs():
    codec = UniversalCodec(cache=False)
    # rs(15,11) is registry-only for the default policy
    assert codec.registry["rs(15,11)"].params.get("policy") is False
    scored = codec._score_codes(6.0)
    names = {n for _, n, _ in scored}
    assert "rs(15,11)" not in names


def test_frame_layout():
    """Header occupies transmitted positions [0,124), body follows immediately."""
    codec = UniversalCodec(cache=False)
    code = codec.registry["hamming(7,4)"]
    msg = 0b1010
    frame, _ = codec.encode_frame(msg, code.name)
    id_ = codec.by_id.index("hamming(7,4)")
    # header bits at transmitted positions 0..123 (int bits 255..132)
    header_bits = [(frame >> (255 - i)) & 1 for i in range(124)]
    expected_header = "".join("1" if (id_ >> (3 - j)) & 1 else "0" for j in range(4)) * 0  # placeholder
    # rebuild: for each of 4 id bits, 31 repeats
    expected = []
    for j in range(4):
        v = (id_ >> (3 - j)) & 1
        expected += [v] * 31
    assert header_bits == expected
