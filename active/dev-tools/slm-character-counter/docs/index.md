# SLM Character Counter

Fine-tune a **Small Language Model** (SLM) to be *perfect* at the **"how many X in Y"** character counting problem — like counting the `r`'s in `strawberry` — without degrading general capabilities.

[GitHub source](https://github.com/calvinloveland/megarepo/tree/main/active/dev-tools/slm-character-counter)

## The Problem

"How many r's in strawberry?" → `3`

Most LLMs fail at this. It's a simple algorithmic task requiring precise character-level tokenization, which autoregressive LLMs with subword tokenizers aren't naturally good at.

## Approach

| Technique | Purpose |
|---|---|
| **Synthetic data generation** | 10K+ diverse training examples covering letters, digits, unicode, zero-count, edge cases |
| **DPO (Direct Preference Optimization)** | Aligns the model toward correct counting and away from plausible wrong answers via preference pairs |
| **LoRA fine-tuning** | Only ~0.7% of parameters change, preserving general capabilities |
| **Mixed training data** | 15% general instruction data mixed in to prevent catastrophic forgetting |

## Architecture

```
slm-character-counter/
├── data/
│   └── generate.py         # Synthetic dataset generator (templates + random words)
├── training/
│   ├── config.py           # Training configuration (dataclass + CLI args)
│   ├── train_dpo.py        # DPO training script (TRL v1.5+ API)
│   └── eval.py             # Comprehensive evaluation suite
├── tests/
│   └── test_counting.py    # 29 unit tests for data generation
├── scripts/
│   ├── setup_venv.sh       # One-command venv setup
│   ├── run_in_nix.sh       # NixOS compat wrapper (libstdc++, zlib)
│   └── run_pipeline.sh     # Full pipeline runner
├── requirements.txt
└── README.md
```

## Quick Start

### 1. Setup

```bash
bash scripts/setup_venv.sh
```

### 2. Generate Data

```bash
bash scripts/run_in_nix.sh python data/generate.py --dpo --train-examples 10000
```

This generates:
- `data/train.jsonl` — 10,000 standard (prompt, answer) pairs
- `data/eval.jsonl` — 500 evaluation pairs
- `data/train_dpo.jsonl` — 10,000 DPO preference pairs (chosen = correct, rejected = plausible wrong)

### 3. Train (CPU — small test)

```bash
# Mini test (~2 min on CPU with 10 examples)
bash scripts/run_in_nix.sh python data/generate.py --dpo --train-examples 10
bash scripts/run_in_nix.sh python training/train_dpo.py --no-cuda --num-epochs 1 --batch-size 2
```

### 4. Train (GPU — real training)

```bash
python training/train_dpo.py --fp16 --batch-size 8 --num-epochs 3 --lr 5e-5
```

### 5. Evaluate

```bash
bash scripts/run_in_nix.sh python training/eval.py \
    --model-path outputs/slm-counter \
    --base-model HuggingFaceTB/SmolLM2-135M-Instruct \
    --num-samples 200
```

### 6. Full Pipeline

```bash
bash scripts/run_pipeline.sh              # full run
bash scripts/run_pipeline.sh --mini       # tiny CPU test (~5 min)
```

## Dataset Design

The data generator creates diverse counting problems:

| Category | Example | Count |
|---|---|---|
| Standard letters | How many r's in strawberry? | 3 |
| Repeated letters | How many s's in mississippi? | 4 |
| Zero count | How many z's in apple? | 0 |
| All same | How many a's in aaaaa? | 5 |
| Digits | How many 1's in 314159? | 2 |
| Special chars | How many -'s in hello-world? | 1 |
| Unicode | How many é's in café? | 1 |
| Case-aware | How many A's in Aardvark? | 2 |
| Long words | How many i's in antidisestablishmentarianism? | 5 |
| General QA (15%) | What is the capital of France? | Paris |

## Why DPO?

DPO directly optimizes the preference between correct and wrong answers without needing RL reward models. The loss function:

```
L = -E[log σ(β(log π_θ(chosen|prompt) - log π_ref(chosen|prompt)
                - β(log π_θ(rejected|prompt) - log π_ref(rejected|prompt)))]
```

This pushes the model's probability of the correct answer up and the wrong answer down, while the reference model prevents over-optimization.

Compared to alternatives:
- **SFT**: Only learns correct answers, doesn't learn what to avoid
- **PPO**: Complex, unstable, needs reward model
- **DPO**: Simple, stable, direct preference signal ✅

## Preserving General Capabilities

Three strategies prevent the model from forgetting general skills:

1. **LoRA**: Only ~0.7% of parameters are trained. The base model's knowledge stays intact.
2. **Mixed training**: 15% of training data is general instruction QA (capitals, math, facts).
3. **Low learning rate**: `5e-5` keeps updates small and localized.

## Model Choices

| Model | Params | Disk | CPU Training | Notes |
|---|---|---|---|---|
| `SmolLM2-135M-Instruct` | 135M | ~270MB | ✅ ~25s/step | Best for CPU |
| `SmolLM2-360M-Instruct` | 360M | ~720MB | ⚠️ ~60s/step | Better accuracy |
| `Qwen2.5-0.5B-Instruct` | 494M | ~1GB | ⚠️ ~90s/step | Good accuracy |
| `Qwen2.5-1.5B-Instruct` | 1.5B | ~3GB | ❌ Needs GPU | Best accuracy |

## NixOS Compatibility

This project works on NixOS via the `scripts/run_in_nix.sh` wrapper, which:
1. Automatically discovers `libstdc++.so.6` and `libz.so.1` paths from nixpkgs
2. Fetches them into the Nix store if needed
3. Sets `LD_LIBRARY_PATH` so PyTorch/NumPy native extensions load correctly

All Python commands should be run through this wrapper on NixOS:
```bash
bash scripts/run_in_nix.sh python <script.py> [args...]
```

## Tests

```bash
# Run all 29 tests (data generation, counting logic, DPO pairs)
bash scripts/run_in_nix.sh python -m pytest tests/ -v
```

## References

- [DPO: Direct Preference Optimization](https://arxiv.org/abs/2305.18290)
- [SmolLM2](https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct)
- [TRL: Transformer Reinforcement Learning](https://github.com/huggingface/trl)
