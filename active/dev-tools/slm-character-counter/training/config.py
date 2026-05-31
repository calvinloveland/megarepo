"""
Training configuration for SLM character counting fine-tuning.

This module defines the default hyperparameters and model choices.
Override via CLI args or environment variables.
"""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class TrainingConfig:
    # ── Model ────────────────────────────────────────────────────────────────
    model_name: str = "HuggingFaceTB/SmolLM2-135M-Instruct"
    """Base model to fine-tune. Small models recommended for CPU training."""

    use_quantization: bool = False
    """Use 4-bit quantization (requires bitsandbytes, useful for GPU memory)."""

    # ── LoRA ─────────────────────────────────────────────────────────────────
    use_lora: bool = True
    """Use LoRA for parameter-efficient fine-tuning."""
    lora_r: int = 8
    """LoRA rank. Lower = fewer parameters, faster training."""
    lora_alpha: int = 16
    """LoRA alpha scaling factor."""
    lora_dropout: float = 0.05
    """LoRA dropout rate."""
    lora_target_modules: list = field(default_factory=lambda: ["q_proj", "v_proj", "k_proj", "o_proj"])
    """Which modules to apply LoRA to."""

    # ── Data ─────────────────────────────────────────────────────────────────
    data_dir: str = "data"
    """Directory containing train.jsonl and eval.jsonl."""
    max_seq_length: int = 512
    """Maximum sequence length for tokenization."""

    # ── Training ─────────────────────────────────────────────────────────────
    output_dir: str = "outputs/slm-counter"
    """Directory to save model checkpoints and logs."""
    num_train_epochs: int = 3
    """Number of training epochs."""
    per_device_train_batch_size: int = 4
    """Batch size per device. Lower for CPU to avoid OOM."""
    per_device_eval_batch_size: int = 4
    """Eval batch size per device."""
    gradient_accumulation_steps: int = 4
    """Accumulate gradients over N steps (effective batch = bs * accum)."""
    learning_rate: float = 5e-5
    """Peak learning rate."""
    lr_scheduler_type: str = "cosine"
    """Learning rate scheduler type."""
    warmup_ratio: float = 0.1
    """Fraction of training steps for warmup."""
    weight_decay: float = 0.01
    """Weight decay for AdamW."""

    # ── DPO specific ─────────────────────────────────────────────────────────
    beta: float = 0.1
    """DPO temperature parameter. Lower = more emphasis on preference."""
    dpo_loss_type: str = "sigmoid"
    """Type of DPO loss: 'sigmoid' (original), 'ipo', 'simpo', etc."""

    # ── ORPO specific ────────────────────────────────────────────────────────
    orpo_alpha: float = 1.0
    """ORPO odds ratio penalty coefficient."""
    orpo_beta: float = 0.1
    """ORPO label smoothing coefficient."""

    # ── Logging & Saving ─────────────────────────────────────────────────────
    logging_steps: int = 10
    save_steps: int = 1000
    eval_steps: int = 500
    save_total_limit: int = 2
    report_to: str = "none"
    """Where to report metrics: 'wandb', 'tensorboard', or 'none'."""
    run_name: Optional[str] = None
    """Run name for logging. Auto-generated if None."""

    # ── CPU / Resource ───────────────────────────────────────────────────────
    dataloader_num_workers: int = 2
    """Number of data loader workers."""
    gradient_checkpointing: bool = False
    """Gradient checkpointing to save memory (slower)."""
    fp16: bool = False
    """Use fp16 training (requires GPU)."""
    bf16: bool = False
    """Use bf16 training (requires Ampere+ GPU)."""
    no_cuda: bool = True
    """Force CPU even if CUDA is available."""

    @classmethod
    def from_args(cls):
        """Parse CLI args into config."""
        import argparse

        parser = argparse.ArgumentParser(description="SLM Character Counter Training")
        parser.add_argument("--model-name", type=str, default=cls.model_name)
        parser.add_argument("--output-dir", type=str, default=cls.output_dir)
        parser.add_argument("--data-dir", type=str, default=cls.data_dir)
        parser.add_argument("--num-epochs", type=int, default=cls.num_train_epochs)
        parser.add_argument("--batch-size", type=int, default=cls.per_device_train_batch_size)
        parser.add_argument("--lr", type=float, default=cls.learning_rate)
        parser.add_argument("--use-lora", action="store_true", default=cls.use_lora)
        parser.add_argument("--no-lora", action="store_false", dest="use_lora")
        parser.add_argument("--lora-r", type=int, default=cls.lora_r)
        parser.add_argument("--beta", type=float, default=cls.beta)
        parser.add_argument("--no-cuda", action="store_true", default=cls.no_cuda)
        parser.add_argument("--fp16", action="store_true", default=cls.fp16)
        parser.add_argument("--gradient-accumulation", type=int, default=cls.gradient_accumulation_steps)
        parser.add_argument("--logging-steps", type=int, default=cls.logging_steps)
        parser.add_argument("--report-to", type=str, default=cls.report_to)
        parser.add_argument("--method", type=str, choices=["dpo", "orpo", "sft"], default="dpo")
        parser.add_argument("--general-ratio", type=float, default=0.15)
        parser.add_argument("--train-examples", type=int, default=10000)
        parser.add_argument("--eval-examples", type=int, default=500)
        parser.add_argument("--seed", type=int, default=42)

        args, _ = parser.parse_known_args()
        config = cls()
        config.model_name = args.model_name
        config.output_dir = args.output_dir
        config.data_dir = args.data_dir
        config.num_train_epochs = args.num_epochs
        config.per_device_train_batch_size = args.batch_size
        config.learning_rate = args.lr
        config.use_lora = args.use_lora
        config.lora_r = args.lora_r
        config.beta = args.beta
        config.no_cuda = args.no_cuda
        config.fp16 = args.fp16
        config.gradient_accumulation_steps = args.gradient_accumulation
        config.logging_steps = args.logging_steps
        config.report_to = args.report_to
        config.general_ratio = args.general_ratio
        config.train_examples = args.train_examples
        config.eval_examples = args.eval_examples
        config.seed = args.seed
        return config, args
