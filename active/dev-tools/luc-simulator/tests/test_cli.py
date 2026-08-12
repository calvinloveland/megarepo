"""Smoke tests for the CLI (fast paths only)."""

from luc_sim.cli import build_parser, cmd_codes, cmd_metrics, cmd_missions


def test_parser_registers_all_commands():
    p = build_parser()
    for cmd in ("codes", "sweep", "metrics", "demo", "plot", "missions"):
        # each subcommand parses with its defaults
        ns = p.parse_args([cmd])
        assert ns.cmd == cmd
        assert callable(getattr(ns, "fn", None))


def test_cmd_codes_runs(capsys):
    ns = build_parser().parse_args(["codes"])
    assert cmd_codes(ns) == 0
    out = capsys.readouterr().out
    assert "13 code instances across 7 families" in out
    assert "polar(32,11)" in out


def test_cmd_metrics_runs(capsys):
    ns = build_parser().parse_args(
        ["metrics", "--frames", "120", "--seed", "3", "--no-cache"]
    )
    assert cmd_metrics(ns) == 0
    out = capsys.readouterr().out
    assert "[1] Codes supported" in out
    assert "[6] Time to switch" in out


def test_cmd_missions_runs(capsys):
    ns = build_parser().parse_args(
        ["missions", "--frames", "120", "--seed", "3", "--no-cache"]
    )
    assert cmd_missions(ns) == 0
    out = capsys.readouterr().out
    assert "throughput" in out and "latency" in out and "robust" in out
