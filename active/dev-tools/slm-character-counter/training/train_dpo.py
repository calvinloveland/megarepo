#!/usr/bin/env python3
"""
DPO (Direct Preference Optimization) training for character counting.

Fine-tunes an SLM using DPO with preference pairs:
  chosen  = correct character count
  rejected = plausible incorrect character count

Uses LoRA adapters to limit parameter changes (~0.7% of params),
preserving general capabilities. Mixed training data (counting + general QA)
further prevents catastrophic forgetting.

API: TRL v1.5+ with DPOConfig + DPOTrainer
"""

import json
import logging
import sys
from pathlib import Path
from typing import Dict

import torch
from datasets import Dataset
from peft import LoraConfig, get_peft_model
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    set_seed,
)
from trl import DPOConfig, DPOTrainer

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from training.config import TrainingConfig

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


# ── Model loading ────────────────────────────────────────────────────────────

def load_base_model(config: TrainingConfig):
    """Load base model with optional quantization."""
    logger.info(f"Loading base model: {config.model_name}")

    quantization_config = None
    if config.use_quantization:
        quantization_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_compute_dtype=torch.float16,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
        )
        logger.info("Using 4-bit quantization")

    device_map = "cpu" if config.no_cuda else "auto"

    model = AutoModelForCausalLM.from_pretrained(
        config.model_name,
        quantization_config=quantization_config,
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

    return model, tokenizer


def setup_lora(model, config: TrainingConfig):
    """Apply LoRA adapters."""
    if not config.use_lora:
        logger.info("LoRA disabled — using full fine-tuning")
        return model

    logger.info(
        f"Setting up LoRA: r={config.lora_r}, alpha={config.lora_alpha}, "
        f"targets={config.lora_target_modules}"
    )

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
    return model


# ── Data formatting ─────────────────────────────────────────────────────────

def build_chat_prompt(prompt_text: str, tokenizer) -> str:
    """Wrap input in the model's chat template."""
    messages = [{"role": "user", "content": prompt_text}]
    return tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)


def load_dpo_dataset(data_dir: str, tokenizer, split: str = "train") -> Dataset:
    """
    Load DPO preference pairs from JSONL.

    Expected: {"prompt": "...", "chosen": "...", "rejected": "..."}
    """
    jsonl_path = Path(data_dir) / f"{split}_dpo.jsonl"
    if not jsonl_path.exists():
        raise FileNotFoundError(
            f"DPO data not found at {jsonl_path}. "
            "Run `python data/generate.py --dpo` first."
        )

    logger.info(f"Loading DPO data from {jsonl_path}")

    data = []
    with open(jsonl_path) as f:
        for line in f:
            item = json.loads(line)
            data.append(item)

    logger.info(f"Loaded {len(data)} DPO {split} examples")

    def format_example(ex: Dict) -> Dict:
        return {
            "prompt": build_chat_prompt(ex["prompt"], tokenizer),
            "chosen": ex["chosen"] + tokenizer.eos_token,
            "rejected": ex["rejected"] + tokenizer.eos_token,
        }

    return Dataset.from_list([format_example(ex) for ex in data])


# ── Quick eval ───────────────────────────────────────────────────────────────

def run_quick_eval(model, tokenizer):
    """Quick accuracy check on canonical test problems."""
    test_cases = [
        ("How many r's in strawberry?", "3"),
        ("How many a's in banana?", "3"),
        ("How many s's in mississippi?", "4"),
        ("How many z's in apple?", "0"),
        ("How many 1's in 314159?", "2"),
        ("How many l's in hello?", "2"),
        ("How many e's in elephant?", "2"),
        ("How many t's in the word 'tattoo'?", "3"),
    ]

    print("\n" + "=" * 60)
    print("QUICK EVALUATION")
    print("=" * 60)

    model.eval()
    correct = 0
    total = len(test_cases)

    for prompt, expected in test_cases:
        formatted = build_chat_prompt(prompt, tokenizer)
        inputs = tokenizer(formatted, return_tensors="pt")
        device = next(model.parameters()).device
        inputs = {k: v.to(device) for k, v in inputs.items()}

        with torch.no_grad():
            outputs = model.generate(
                **inputs,
                max_new_tokens=10,
                temperature=0.1,
                do_sample=False,
                pad_token_id=tokenizer.pad_token_id,
            )

        response = tokenizer.decode(
            outputs[0][inputs["input_ids"].shape[1]:],
            skip_special_tokens=True,
        ).strip().split("\n")[0].strip()

        is_correct = response == expected
        if is_correct:
            correct += 1

        status = "✓" if is_correct else "✗"
        print(f"  {status} Q: {prompt}")
        print(f"       Expected: '{expected}'  Got: '{response}'")

    accuracy = correct / total * 100
    print(f"\n  Accuracy: {correct}/{total} = {accuracy:.1f}%")
    print("=" * 60)


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    config, args = TrainingConfig.from_args()

    set_seed(config.seed)
    logger.info(f"Starting DPO training")
    logger.info(f"Model: {config.model_name}")
    logger.info(f"Data: {config.data_dir}")
    logger.info(f"Output: {config.output_dir}")

    # ── Step 1: Generate data if needed ─────────────────────────────────────
    data_dir = Path(config.data_dir)
    if not (data_dir / "train_dpo.jsonl").exists():
        logger.info("Generating dataset...")
        from data.generate import generate_dataset, prepare_dpo_pairs, save_dataset

        train_data = generate_dataset(
            num_examples=getattr(args, "train_examples", 10000),
            seed=config.seed,
            general_ratio=getattr(args, "general_ratio", 0.15),
        )
        save_dataset(train_data, data_dir, "train")

        dpo_train = prepare_dpo_pairs(train_data, seed=config.seed)
        save_dataset(dpo_train, data_dir, "train_dpo")

        logger.info(f"Generated {len(train_data)} examples -> data/train_dpo.jsonl")

    # ── Step 2: Load model ─────────────────────────────────────────────────
    model, tokenizer = load_base_model(config)
    model = setup_lora(model, config)

    # ── Step 3: Load dataset ────────────────────────────────────────────────
    train_dataset = load_dpo_dataset(config.data_dir, tokenizer, "train")
    eval_dataset = None  # We do separate eval after training

    # ── Step 4: DPOConfig ──────────────────────────────────────────────────
    # DPOConfig extends TrainingArguments with DPO-specific fields
    dpo_config = DPOConfig(
        output_dir=config.output_dir,
        num_train_epochs=config.num_train_epochs,
        per_device_train_batch_size=config.per_device_train_batch_size,
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
        run_name=config.run_name or "slm-counter-dpo",
        dataloader_num_workers=config.dataloader_num_workers,
        use_cpu=config.no_cuda,
        fp16=config.fp16,
        bf16=config.bf16,
        remove_unused_columns=False,
        ddp_find_unused_parameters=False if config.use_lora else None,
        push_to_hub=False,
        # DPO-specific parameters
        beta=config.beta,
        max_length=config.max_seq_length,
        disable_dropout=True,
        loss_type="sigmoid",
    )

    logger.info(
        f"Training with {train_dataset.num_rows} examples, "
        f"{config.num_train_epochs} epochs, "
        f"batch_size={config.per_device_train_batch_size}, "
        f"lr={config.learning_rate}"
    )

    # ── Step 5: DPOTrainer ─────────────────────────────────────────────────
    trainer = DPOTrainer(
        model=model,
        ref_model=None,  # TRL automatically creates reference model
        args=dpo_config,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        processing_class=tokenizer,  # Replaces 'tokenizer' in new TRL
    )

    # ── Step 6: Train ──────────────────────────────────────────────────────
    logger.info("Starting training...")
    train_result = trainer.train()

    # ── Step 7: Save ────────────────────────────────────────────────────────
    trainer.save_model(config.output_dir)
    tokenizer.save_pretrained(config.output_dir)

    metrics = train_result.metrics
    trainer.log_metrics("train", metrics)
    trainer.save_metrics("train", metrics)

    logger.info(f"Training complete! Model saved to {config.output_dir}")

    # ── Step 8: Quick eval ─────────────────────────────────────────────────
    run_quick_eval(model, tokenizer)


if __name__ == "__main__":
    main()
