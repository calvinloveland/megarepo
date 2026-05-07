#!/usr/bin/env python3
"""Benchmark OpenRouter free models on the Pig Latin tiny-model task.

Runs one isolated hiring-harness workspace per candidate model, using:
- CEO: github-copilot/gpt-5.4
- Reviewer: github-copilot/gpt-5.4
- Candidate hire: one OpenRouter free model at a time

The script is resumable: if a model already has a parsed result JSON, it is skipped.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import textwrap
import time
from pathlib import Path
from typing import Any

REPO_ROOT = Path("/home/calvin/code/megarepo")
HARNESS_DIR = REPO_ROOT / "active/dev-tools/pi-hiring-harness"
FREE_MODELS_FILE = Path("/tmp/openrouter_free_models.txt")
DEFAULT_ROOT_PREFIX = "pi-free-model-benchmark-"
CEO_MODEL = "github-copilot/gpt-5.4"
REVIEWER_NAME = "reviewer-gpt54"
REVIEWER_MODEL = "github-copilot/gpt-5.4"
PER_MODEL_TIMEOUT_SECONDS = 2400

TASK_OBJECTIVE = (
    "Create and actually train a tiny local Pig Latin model using only Python stdlib and numpy. "
    "Use a deliberately simple architecture that can learn the transformation robustly on CPU, "
    "such as a softmax classifier or tiny MLP that predicts the first-vowel split index or another "
    "simple latent that still yields correct Pig Latin."
)

TASK_ACCEPTANCE = (
    "Create pig_latin_dataset.jsonl with input/target pairs, train_pig_latin.py with CLI args "
    "--epochs --model-out --samples-out --metrics-out --quiet, tiny_piglatin_model.npz, "
    "sample_generations.json as a JSON object, training_metrics.json with initial_loss/final_loss/epochs/"
    "trained_examples, and update README.md. Running the script with the provided CLI flags must succeed."
)

VALIDATION_COMMANDS = [
    "python train_pig_latin.py --epochs 200 --model-out tiny_piglatin_model.npz --samples-out sample_generations.json --metrics-out training_metrics.json --quiet",
    "python - <<'PY'\n"
    "import json\n"
    "metrics=json.load(open('training_metrics.json'))\n"
    "assert metrics['epochs'] >= 50, metrics\n"
    "assert metrics['final_loss'] < metrics['initial_loss'], metrics\n"
    "assert metrics.get('trained_examples', 0) >= 20, metrics\n"
    "samples=json.load(open('sample_generations.json'))\n"
    "assert isinstance(samples, dict), samples\n"
    "expected={'hello':'ellohay','world':'orldway','pig latin':'igpay atinlay','banana':'ananabay'}\n"
    "for key,val in expected.items():\n"
    "    assert samples.get(key,'').lower() == val, (key, samples.get(key), val)\n"
    "PY",
]

REVIEWER_PROMPT = textwrap.dedent(
    f"""\
    ---
    name: {REVIEWER_NAME}
    description: Fixed reviewer backed by {REVIEWER_MODEL}
    role: reviewer
    model: {REVIEWER_MODEL}
    tools: read,bash
    input_price_per_million: 0
    output_price_per_million: 0
    ---

    You are a strict reviewer.
    Assess every aspect of the work relative to the resume and contract.
    You must comment on resume accuracy, especially token estimates, latency, cost, validation outcome, and whether the final artifact really solved the task.
    """
)

WORKER_PROMPT_TEMPLATE = textwrap.dedent(
    """\
    ---
    name: {name}
    description: Candidate worker backed by {model}
    role: implementer
    model: openrouter/{model}
    tools: read,edit,bash
    input_price_per_million: 0
    output_price_per_million: 0
    ---

    You are the implementation worker for a tiny Pig Latin model benchmark.

    Your deliverable MUST be runnable and MUST satisfy deterministic validation.
    Use only Python stdlib + numpy.
    Do not use torch, transformers, sklearn, or external downloads.

    Implementation blueprint:
    1. Create `pig_latin_dataset.jsonl` containing JSON lines with `input` and `target`.
    2. Write `train_pig_latin.py` with CLI flags:
       - `--epochs`
       - `--model-out`
       - `--samples-out`
       - `--metrics-out`
       - `--quiet`
    3. Implement an actually trained tiny model in numpy:
       - Use a character-position one-hot feature vector for each word.
       - Train a softmax classifier or tiny MLP to predict the first-vowel split index or another simple latent that still yields correct Pig Latin.
       - The decoder should deterministically convert the learned prediction into Pig Latin.
       - For multi-word inputs, translate each word independently and join with spaces.
    4. Save model weights to the exact `--model-out` path.
    5. Save metrics JSON to the exact `--metrics-out` path with keys:
       - `initial_loss`
       - `final_loss`
       - `epochs`
       - `trained_examples`
    6. Save samples JSON OBJECT to the exact `--samples-out` path with these exact keys:
       - `hello`
       - `world`
       - `pig latin`
       - `banana`

    The expected outputs for those keys are exactly:
    - `hello` -> `ellohay`
    - `world` -> `orldway`
    - `pig latin` -> `igpay atinlay`
    - `banana` -> `ananabay`

    Important:
    - The script must honor the CLI output paths, not hardcoded filenames.
    - The model must really train; `final_loss` must be lower than `initial_loss`.
    - Keep the code small and robust.
    - Remove junk files if you create any by mistake.
    """
)


def slugify(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "-", value)


def worker_key(name: str, model: str) -> str:
    return f"{model}::{name}"


def discover_root(root_arg: str | None) -> Path:
    if root_arg:
        root = Path(root_arg)
        root.mkdir(parents=True, exist_ok=True)
        return root
    return Path(tempfile.mkdtemp(prefix=DEFAULT_ROOT_PREFIX, dir="/tmp"))


def write_workspace(root: Path, model: str) -> tuple[Path, str]:
    slug = slugify(model)
    workspace = root / slug
    workers_dir = workspace / ".pi" / "workers"
    workers_dir.mkdir(parents=True, exist_ok=True)
    (workspace / "README.md").write_text("# Free model benchmark workspace\n", encoding="utf-8")
    (workers_dir / f"{slug}.md").write_text(
        WORKER_PROMPT_TEMPLATE.format(name=slug, model=model),
        encoding="utf-8",
    )
    (workers_dir / f"{REVIEWER_NAME}.md").write_text(REVIEWER_PROMPT, encoding="utf-8")
    return workspace, slug


def build_payload(workspace: Path, slug: str) -> dict[str, Any]:
    return {
        "budgetUsd": 1.0,
        "mode": "run",
        "workerScope": "project",
        "workerNames": [slug, REVIEWER_NAME],
        "maxCandidatesPerJob": 2,
        "enforceBudget": True,
        "persistLedger": True,
        "reviewMode": "selected",
        "reviewerWorkerName": REVIEWER_NAME,
        "jobs": [
            {
                "id": "train-piglatin-llm",
                "objective": TASK_OBJECTIVE,
                "acceptanceCriteria": TASK_ACCEPTANCE,
                "preferredRole": "implementer",
                "requiredFiles": [
                    "pig_latin_dataset.jsonl",
                    "train_pig_latin.py",
                    "tiny_piglatin_model.npz",
                    "sample_generations.json",
                    "training_metrics.json",
                    "README.md",
                ],
                "validationCommands": VALIDATION_COMMANDS,
                "cwd": str(workspace),
            }
        ],
    }


def parse_latest_ledger(workspace: Path) -> Path | None:
    ledger_dir = workspace / ".pi" / "hiring-runs"
    if not ledger_dir.exists():
        return None
    ledgers = sorted(ledger_dir.glob("*.json"))
    return ledgers[-1] if ledgers else None


def score_result(result: dict[str, Any]) -> float:
    score = 0.0
    if result.get("validationOk") is True:
        score += 1000.0
    if result.get("reviewVerdict") == "pass":
        score += 100.0
    elif result.get("reviewVerdict") == "fail":
        score -= 100.0
    final_loss = result.get("finalLoss")
    if isinstance(final_loss, (int, float)):
        score += max(0.0, 100.0 - float(final_loss) * 10.0)
    audit = result.get("employeeReviewAudit") or {}
    errors = audit.get("errors") or {}
    score -= float(errors.get("inputTokensRelative") or 0.0)
    score -= float(errors.get("outputTokensRelative") or 0.0)
    score -= float(errors.get("costRelative") or 0.0)
    return round(score, 4)


def collect_result(model: str, slug: str, workspace: Path, ledger: Path, elapsed: float) -> dict[str, Any]:
    payload = json.loads(ledger.read_text())
    job = payload["details"]["jobs"][0]

    metrics = None
    if (workspace / "training_metrics.json").exists():
        metrics = json.loads((workspace / "training_metrics.json").read_text())

    samples = None
    if (workspace / "sample_generations.json").exists():
        samples = json.loads((workspace / "sample_generations.json").read_text())

    result = {
        "model": model,
        "slug": slug,
        "workspace": str(workspace),
        "ledger": str(ledger),
        "selectedWorker": job.get("selectedApplication", {}).get("workerName"),
        "validationOk": job.get("validation", {}).get("ok"),
        "validationSummary": job.get("validation", {}).get("summary"),
        "reviewVerdict": (job.get("employeeReviewAudit") or {}).get("actual", {}).get("reviewVerdict"),
        "reviewer": job.get("review", {}).get("workerName"),
        "finalLoss": metrics.get("final_loss") if metrics else None,
        "initialLoss": metrics.get("initial_loss") if metrics else None,
        "trainedExamples": metrics.get("trained_examples") if metrics else None,
        "samples": samples,
        "employeeReviewAudit": job.get("employeeReviewAudit"),
        "reviewExcerpt": (job.get("review", {}).get("output") or "")[:1500],
        "elapsedSeconds": elapsed,
        "artifacts": sorted(str(p.relative_to(workspace)) for p in workspace.glob("*") if p.is_file()),
    }
    result["score"] = score_result(result)
    return result


def run_one(model: str, root: Path) -> dict[str, Any]:
    workspace, slug = write_workspace(root, model)
    result_path = workspace / "benchmark-result.json"
    if result_path.exists():
        return json.loads(result_path.read_text())

    payload = build_payload(workspace, slug)
    prompt = (
        "You are testing the hire_workers tool. "
        "Call hire_workers exactly once with this payload, then give a short summary of what happened.\n\n"
        + json.dumps(payload, indent=2)
    )
    started = time.time()
    proc = subprocess.run(
        [
            "pi",
            "-e",
            str(HARNESS_DIR),
            "--model",
            CEO_MODEL,
            "--no-builtin-tools",
            "--tools",
            "hire_workers",
            "--mode",
            "json",
            "-p",
            "--no-session",
            prompt,
        ],
        cwd=workspace,
        capture_output=True,
        text=True,
        timeout=PER_MODEL_TIMEOUT_SECONDS,
    )
    elapsed = round(time.time() - started, 3)
    (workspace / "run.jsonl").write_text(proc.stdout, encoding="utf-8")
    if proc.stderr:
        (workspace / "run.stderr.log").write_text(proc.stderr, encoding="utf-8")

    ledger = parse_latest_ledger(workspace)
    if ledger is None:
        result = {
            "model": model,
            "slug": slug,
            "workspace": str(workspace),
            "status": "no_ledger",
            "elapsedSeconds": elapsed,
            "stderr": proc.stderr[-2000:],
        }
    else:
        result = collect_result(model, slug, workspace, ledger, elapsed)

    result_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


def render_html(root: Path, results: list[dict[str, Any]]) -> Path:
    html_path = root / "benchmark-report.html"
    rows = []
    for index, result in enumerate(results, 1):
        rows.append(
            f"<tr>"
            f"<td>{index}</td>"
            f"<td>{result.get('model','')}</td>"
            f"<td>{result.get('validationOk')}</td>"
            f"<td>{result.get('reviewVerdict')}</td>"
            f"<td>{result.get('score')}</td>"
            f"<td>{result.get('finalLoss')}</td>"
            f"<td>{result.get('elapsedSeconds')}</td>"
            f"<td><a href='file://{result.get('workspace','')}'>{result.get('workspace','')}</a></td>"
            f"</tr>"
        )
    html = f"""<!doctype html>
<html>
<head>
  <meta charset='utf-8'>
  <title>Free Model Benchmark</title>
  <style>
    body {{ font-family: system-ui, sans-serif; margin: 24px; background: #0f172a; color: #e2e8f0; }}
    table {{ border-collapse: collapse; width: 100%; background: #111827; }}
    th, td {{ border: 1px solid #334155; padding: 8px; text-align: left; vertical-align: top; }}
    th {{ background: #1e293b; }}
    a {{ color: #93c5fd; }}
  </style>
</head>
<body>
  <h1>OpenRouter Free Model Benchmark</h1>
  <p>CEO: {CEO_MODEL} · Reviewer: {REVIEWER_MODEL}</p>
  <p>Root: {root}</p>
  <table>
    <thead>
      <tr>
        <th>Rank</th>
        <th>Model</th>
        <th>Validation</th>
        <th>Review verdict</th>
        <th>Score</th>
        <th>Final loss</th>
        <th>Elapsed (s)</th>
        <th>Workspace</th>
      </tr>
    </thead>
    <tbody>
      {''.join(rows)}
    </tbody>
  </table>
</body>
</html>
"""
    html_path.write_text(html, encoding="utf-8")
    return html_path


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Benchmark OpenRouter free models")
    parser.add_argument("--root", help="Existing benchmark root to resume into")
    args = parser.parse_args()

    root = discover_root(args.root)
    models = [line.strip() for line in FREE_MODELS_FILE.read_text().splitlines() if line.strip()]
    results = []

    for index, model in enumerate(models, 1):
        print(f"[{index}/{len(models)}] running {model}", flush=True)
        try:
          result = run_one(model, root)
        except subprocess.TimeoutExpired:
          result = {
              "model": model,
              "slug": slugify(model),
              "workspace": str(root / slugify(model)),
              "status": "timeout",
          }
          (root / slugify(model) / "benchmark-result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
        results.append(result)
        print(json.dumps({k: result.get(k) for k in ["model", "validationOk", "reviewVerdict", "score", "status"]}), flush=True)

    results.sort(key=lambda r: (r.get("validationOk") is True, r.get("reviewVerdict") == "pass", r.get("score", -9999)), reverse=True)
    (root / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    report = render_html(root, results)

    print(f"RESULT_ROOT={root}")
    print(f"RESULTS_JSON={root / 'results.json'}")
    print(f"REPORT_HTML={report}")
    print("TOP_10")
    for result in results[:10]:
        print(json.dumps({k: result.get(k) for k in ["model", "validationOk", "reviewVerdict", "score", "finalLoss", "workspace"]}))


if __name__ == "__main__":
    main()
