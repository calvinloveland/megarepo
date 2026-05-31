#!/usr/bin/env python3
"""
ORPO (Odds Ratio Preference Optimization) training for character counting.

ORPO combines SFT and preference optimization in a single stage.
It uses an odds ratio loss that penalizes rejected responses while
reinforcing chosen responses, without needing a reference model.

Advantages for this task:
  - No reference model = lower memory usage
  - Single-stage training = simpler pipeline
  - Strong preference signal for correct character counting
"""

import json
import logging
import sys
from pathlib import Path
from typing import Dict, List

import torch
from datasets import Dataset
from peft import LoraConfig, get_peft_model
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    TrainingArguments,
    set_seed,
)
from trl import ORPOTrainer

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from training.config import TrainingConfig

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def load_model_and_tokenizer(config: TrainingConfig):
    """Load base model for ORPO training."""
    logger.info(f"Loading base model: {config.model_name}")

    device_map = "cpu" if config.no_cuda else "auto"

    model = AutoModelForCausalLM.from_pretrained(
        config.model_name,
        device_map=device_map,
        dtype=torch.float32,
        trust_remote_code=True,
    )

    tokenizer = AutoTokenizer.from_pretrained(
        config.model_name,
        trust_remote_code=True,
        padding_side="left",
    )

    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # Apply LoRA
    if config.use_lora:
        peft_config = LoraConfig(
            r=config.lora_r,
            lora_alpha=config.lora_alpha,
            lora_dropout=config.lora_dropout,
            target_modules=config.lora_target_modules,
            bias="none",
            task_type="CAUSAL_LM",
        )
        model = get_peft_model(model, peft_config)
        model.print_trainable_parameters()

    return model, tokenizer


def build_chat_prompt(prompt_text: str, tokenizer) -> str:
    """Wrap input in the model's chat template."""
    messages = [{"role": "user", "content": prompt_text}]
    return tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)


def load_orpo_dataset(data_dir: str, tokenizer, split: str = "train") -> Dataset:
    """
    Load ORPO-format dataset.

    ORPO needs: prompt, chosen, rejected (same structure as DPO).
    """
    jsonl_path = Path(data_dir) / f"{split}_dpo.jsonl"
    if not jsonl_path.exists():
        raise FileNotFoundError(
            f"No DPO-formatted data found at {jsonl_path}. "
            "Run `python data/generate.py --dpo` first."
        )

    logger.info(f"Loading ORPO data from {jsonl_path}")

    data = []
    with open(jsonl_path) as f:
        for line in f:
            item = json.loads(line)
            data.append(item)

    logger.info(f"Loaded {len(data)} {split} examples")

    def format_example(ex: Dict) -> Dict:
        return {
            "prompt": build_chat_prompt(ex["prompt"], tokenizer),
            "chosen": ex["chosen"] + tokenizer.eos_token,
            "rejected": ex["rejected"] + tokenizer.eos_token,
        }

    return Dataset.from_list([format_example(ex) for ex in data])


def main():
    config, args = TrainingConfig.from_args()

    set_seed(config.seed)
    logger.info("Starting ORPO training")
    logger.info(f"Model: {config.model_name}")
    logger.info(f"Data: {config.data_dir}")
    logger.info(f"Orpo alpha: {config.orpo_alpha}, beta: {config.orpo_beta}")

    # ── Generate data if needed ──────────────────────────────────────────────
    data_dir = Path(config.data_dir)
    if not (data_dir / "train_dpo.jsonl").exists():
        logger.info("Generating dataset with DPO pairs...")
        from data.generate import generate_dataset, prepare_dpo_pairs, save_dataset

        train_data = generate_dataset(
            num_examples=getattr(args, "train_examples", 10000),
            seed=config.seed,
            general_ratio=getattr(args, "general_ratio", 0.15),
        )
        save_dataset(train_data, data_dir, "train")

        dpo_train = prepare_dpo_pairs(train_data, seed=config.seed)
        save_dataset(dpo_train, data_dir, "train_dpo")

    # ── Load model and dataset ───────────────────────────────────────────────
    model, tokenizer = load_model_and_tokenizer(config)
    train_dataset = load_orpo_dataset(config.data_dir, tokenizer, "train")

    # ── Training arguments ───────────────────────────────────────────────────
    training_args = TrainingArguments(
        output_dir=config.output_dir,
        num_train_epochs=config.num_train_epochs,
        per_device_train_batch_size=config.per_device_train_batch_size,
        per_device_eval_batch_size=config.per_device_eval_batch_size,
        gradient_accumulation_steps=config.gradient_accumulation_steps,
        learning_rate=config.learning_rate,
        lr_scheduler_type=config.lr_scheduler_type,
        warmup_ratio=config.warmup_ratio,
        weight_decay=config.weight_decay,
        logging_steps=config.logging_steps,
        save_steps=config.save_steps,
        save_total_limit=config.save_total_limit,
        eval_strategy="no",
        report_to=config.report_to if config.report_to != "none" else "none",
        run_name=config.run_name or "slm-counter-orpo",
        dataloader_num_workers=config.dataloader_num_workers,
        fp16=config.fp16,
        bf16=config.bf16,
        use_cpu=config.no_cuda,
        remove_unused_columns=False,
        ddp_find_unused_parameters=False if config.use_lora else None,
        push_to_hub=False,
    )

    # ── ORPO Trainer ─────────────────────────────────────────────────────────
    trainer = ORPOTrainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        tokenizer=tokenizer,
        max_length=config.max_seq_length,
        max_prompt_length=config.max_seq_length // 2,
        beta=config.orpo_beta,
        alpha=config.orpo_alpha,
    )

    # ── Train ────────────────────────────────────────────────────────────────
    logger.info("Starting ORPO training...")
    train_result = trainer.train()

    # ── Save ─────────────────────────────────────────────────────────────────
    trainer.save_model(config.output_dir)
    tokenizer.save_pretrained(config.output_dir)

    metrics = train_result.metrics
    trainer.log_metrics("train", metrics)
    trainer.save_metrics("train", metrics)

    logger.info(f"ORPO training complete! Model saved to {config.output_dir}")


if __name__ == "__main__":
    main()
