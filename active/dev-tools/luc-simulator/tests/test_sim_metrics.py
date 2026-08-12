"""Tests for the link simulator and the LUC metrics report."""

from luc_sim.channel import DynamicChannel
from luc_sim.codec import UniversalCodec
from luc_sim.metrics import format_report, luc_metrics
from luc_sim.sim import best_fixed_code, bler_sweep, run_link, snr_for_target_bler


def test_link_report_aggregates():
    codec = UniversalCodec(cache=False, profile_frames=120)
    channel = DynamicChannel([(0, 9.0), (60, 4.0), (120, 9.0)])
    report = run_link(codec, channel, 180, seed=1, adaptive=True)
    assert len(report.records) == 180
    assert 0.0 <= report.bler() <= 1.0
    assert 0.0 <= report.outage_rate() <= 1.0
    assert 0.0 <= report.goodput() <= 1.0
    assert report.avg_queries() >= 0.0
    assert report.queries_per_info_bit() >= 0.0
    # BLER and outage are consistent with per-record counts
    bad = sum(1 for r in report.records if not r.ok)
    assert abs(report.bler() - bad / 180) < 1e-9


def test_bler_sweep_monotonic():
    codec = UniversalCodec(cache=False)
    points = bler_sweep(codec, "hamming(15,11)", [2.0, 4.0, 6.0, 8.0], n_frames=200, cache=False)
    blers = [b for _, b, _ in points]
    assert blers == sorted(blers, reverse=True)  # BLER falls as SNR rises


def test_snr_for_target():
    codec = UniversalCodec(cache=False)
    snr = snr_for_target_bler(codec, "hamming(15,11)", 0.05, [2.0, 4.0, 6.0, 8.0, 10.0],
                              n_frames=200, cache=False)
    assert snr is not None and 4.0 <= snr <= 10.0


def test_best_fixed_code_returns_name():
    codec = UniversalCodec(cache=False, profile_frames=150)
    channel = DynamicChannel([(0, 7.0)])
    name = best_fixed_code(codec, channel.mean_snr_db(100))
    assert name in codec.registry


def test_luc_metrics_shape():
    codec = UniversalCodec(cache=False, profile_frames=150)
    channel = DynamicChannel([(0, 12.0), (60, 5.0), (120, 9.0), (180, 2.5), (240, 10.0)])
    m = luc_metrics(codec, channel, n_frames=300, seed=2, cache=False,
                    snr_grid=[2.0, 4.0, 6.0, 8.0, 10.0, 12.0])
    assert m["metric_1_codes_supported"]["instances"] == 13
    assert len(m["metric_1_codes_supported"]["families"]) == 7
    assert "metric_2_channel_latency" in m
    assert "metric_3_signal_gain_db" in m
    assert "metric_4_bler_at_5db" in m and len(m["metric_4_bler_at_5db"]) == 13
    assert "metric_5_decoder_power" in m
    assert "metric_6_switch_time" in m
    # adaptive must not be worse than SoTA on the same channel
    assert m["adaptive_link"]["bler"] <= m["fixed_link"]["bler"] + 0.05


def test_format_report_runs():
    codec = UniversalCodec(cache=False, profile_frames=100)
    channel = DynamicChannel([(0, 8.0), (100, 3.0), (200, 8.0)])
    m = luc_metrics(codec, channel, n_frames=200, seed=3, cache=False,
                    snr_grid=[2.0, 4.0, 6.0, 8.0])
    text = format_report(m)
    assert "[1]" in text and "[6]" in text and "adaptive" in text
