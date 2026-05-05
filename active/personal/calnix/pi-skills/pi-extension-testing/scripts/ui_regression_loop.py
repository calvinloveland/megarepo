#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Sequence

from capture_pi_window import capture_window, find_matching_window, format_grim_geometry, load_sway_tree
from compare_pi_screenshots import DiffStats, compare_images, save_diff_report

ROOT = Path(__file__).resolve().parents[2]
HEURISTIC_PACKAGE = ROOT / "pi-packages" / "pi-ui-heuristic-critique"
DEFAULT_OUTPUT_DIR = ROOT / "artifacts" / "ui-regression"


@dataclass(frozen=True)
class RegressionResult:
    status: str
    output_dir: str
    baseline_path: str
    current_path: str | None
    diff_path: str | None
    diff_json_path: str | None
    report_path: str
    judge_output: str | None
    diff_stats: DiffStats | None


def _capture_selector(*, focused: bool, title: str | None, pid: int | None) -> str:
    tree = load_sway_tree()
    window = find_matching_window(tree, focused=focused, title_substring=title, pid=pid)
    if window is None:
        raise RuntimeError("No matching Sway window found.")
    return format_grim_geometry(window["rect"])


def capture_pi_window_to_path(output_path: Path, *, focused: bool = True, title: str | None = None, pid: int | None = None) -> None:
    geometry = _capture_selector(focused=focused, title=title, pid=pid)
    exit_code = capture_window(output_path, geometry=geometry)
    if exit_code != 0:
        raise RuntimeError(f"grim failed with exit code {exit_code}")


JudgeRunner = Callable[[Path, Path, Path, Path, str], str]
CaptureRunner = Callable[..., None]


def default_judge_runner(
    baseline_path: Path,
    current_path: Path,
    diff_path: Path,
    diff_json_path: Path,
    subject: str,
) -> str:
    diff_payload = json.loads(diff_json_path.read_text(encoding="utf-8"))
    prompt = (
        f"@{baseline_path} @{current_path} @{diff_path} "
        f"/ui-heuristic-score {subject}\n\nDiff metadata:\n{json.dumps(diff_payload, indent=2)}"
    )
    command: Sequence[str] = ["pi", "-p", "--no-extensions", "-e", str(HEURISTIC_PACKAGE), prompt]
    proc = subprocess.run(command, check=False, capture_output=True, text=True)
    output = ((proc.stdout or "") + (proc.stderr or "")).strip()
    if proc.returncode != 0:
        raise RuntimeError(output or f"judge command failed with exit code {proc.returncode}")
    return output


def write_report(result: RegressionResult) -> None:
    report_path = Path(result.report_path)
    lines = [
        "# UI Regression Report",
        "",
        f"- Status: `{result.status}`",
        f"- Baseline: `{result.baseline_path}`",
    ]
    if result.current_path:
        lines.append(f"- Current: `{result.current_path}`")
    if result.diff_path:
        lines.append(f"- Diff image: `{result.diff_path}`")
    if result.diff_json_path:
        lines.append(f"- Diff metadata: `{result.diff_json_path}`")
    lines.append("")

    if result.diff_stats is not None:
        lines.extend(
            [
                "## Diff summary",
                "",
                f"- Canvas: `{result.diff_stats.width}x{result.diff_stats.height}`",
                f"- Changed pixels: `{result.diff_stats.changed_pixels}`",
                f"- Changed ratio: `{result.diff_stats.changed_ratio:.6f}`",
                f"- Bounding box: `{json.dumps(result.diff_stats.bbox) if result.diff_stats.bbox else 'none'}`",
                "",
            ]
        )

    if result.judge_output:
        lines.extend(["## Heuristic score", "", result.judge_output.strip(), ""])
    elif result.status == "baseline-created":
        lines.extend(
            [
                "## Next step",
                "",
                "Baseline created. Re-run this command after a UI change to produce a diff and heuristic score.",
                "",
            ]
        )

    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(lines).strip() + "\n", encoding="utf-8")


def run_regression_loop(
    *,
    output_dir: Path = DEFAULT_OUTPUT_DIR,
    subject: str = "Pi UI regression review",
    focused: bool = True,
    title: str | None = None,
    pid: int | None = None,
    judge_runner: JudgeRunner | None = default_judge_runner,
    capture_runner: CaptureRunner = capture_pi_window_to_path,
) -> RegressionResult:
    output_dir = output_dir.expanduser().resolve()
    baseline_path = output_dir / "baseline.png"
    current_path = output_dir / "current.png"
    diff_path = output_dir / "diff.png"
    diff_json_path = output_dir / "diff.json"
    report_path = output_dir / "report.md"

    if not baseline_path.exists():
        capture_runner(baseline_path, focused=focused, title=title, pid=pid)
        result = RegressionResult(
            status="baseline-created",
            output_dir=str(output_dir),
            baseline_path=str(baseline_path),
            current_path=None,
            diff_path=None,
            diff_json_path=None,
            report_path=str(report_path),
            judge_output=None,
            diff_stats=None,
        )
        write_report(result)
        return result

    capture_runner(current_path, focused=focused, title=title, pid=pid)
    diff_stats = compare_images(baseline_path, current_path, diff_path)
    save_diff_report(diff_stats, diff_json_path)
    judge_output = judge_runner(baseline_path, current_path, diff_path, diff_json_path, subject) if judge_runner else None
    result = RegressionResult(
        status="compared",
        output_dir=str(output_dir),
        baseline_path=str(baseline_path),
        current_path=str(current_path),
        diff_path=str(diff_path),
        diff_json_path=str(diff_json_path),
        report_path=str(report_path),
        judge_output=judge_output,
        diff_stats=diff_stats,
    )
    write_report(result)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Capture, diff, and score a Pi UI regression artifact set")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR), help="Directory for baseline/current/diff/report artifacts")
    parser.add_argument("--subject", default="Pi UI regression review", help="Short subject passed to the heuristic scoring prompt")
    parser.add_argument("--focused", action="store_true", help="Capture the currently focused window")
    parser.add_argument("--title", help="Capture the first window whose title or app_id contains this substring")
    parser.add_argument("--pid", type=int, help="Capture the window for a specific process id")
    parser.add_argument("--skip-judge", action="store_true", help="Do not invoke Pi for the heuristic scoring step")
    args = parser.parse_args()

    focused = args.focused or (not args.title and args.pid is None)
    try:
        result = run_regression_loop(
            output_dir=Path(args.output_dir),
            subject=args.subject,
            focused=focused,
            title=args.title,
            pid=args.pid,
            judge_runner=None if args.skip_judge else default_judge_runner,
        )
    except Exception as exc:  # pragma: no cover - CLI guardrail
        sys.stderr.write(f"{exc}\n")
        return 1

    print(json.dumps({
        **asdict(result),
        "diff_stats": asdict(result.diff_stats) if result.diff_stats else None,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
