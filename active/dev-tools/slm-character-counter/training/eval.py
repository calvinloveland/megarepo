#!/usr/bin/env python3
"""
Comprehensive evaluation for character counting fine-tuned models.

Tests on:
- Standard counting problems (letters, digits, special chars)
- Zero-count cases
- Case sensitivity
- Long words
- General instruction following (to check for catastrophic forgetting)
"""

import argparse
import json
import logging
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from training.config import TrainingConfig

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


# ── Test cases ────────────────────────────────────────────────────────────────

COUNTING_TESTS = [
    # (prompt, expected_answer)
    ("How many r's in strawberry?", "3"),
    ("How many a's in banana?", "3"),
    ("How many s's in mississippi?", "4"),
    ("How many p's in apple?", "2"),
    ("How many e's in elephant?", "2"),
    ("How many l's in hello?", "2"),
    ("How many t's in the word 'tattoo'?", "3"),
    ("How many o's in bookkeeper?", "2"),
    ("How many z's in apple?", "0"),
    ("How many q's in strawberry?", "0"),
    ("How many b's in banana?", "1"),
    ("How many n's in banana?", "2"),
    ("Count the number of e's in sentence.", "3"),
    ("How many 1's in 314159?", "2"),
    ("How many 5's in 86753095555?", "4"),
    ("How many 0's in 10000000000?", "10"),
    ("How many -'s in hello-world?", "1"),
    ("How many spaces in 'hello world'?", "1"),
    ("How many a's in Aardvark?", "2"),
    ("How many a's in aaaaa?", "5"),
    ("How many é's in café?", "1"),
]

GENERAL_TESTS = [
    ("What is the capital of France?", "Paris"),
    ("What is 2 + 2?", "4"),
    ("How many days are in a week?", "7"),
    ("What color is the sky on a clear day?", "Blue"),
    ("What is 3 * 4?", "12"),
    ("Write a short greeting.", "Hello"),
]


def build_chat_prompt(prompt_text: str, tokenizer) -> str:
    """Wrap input in the model's chat template."""
    messages = [{"role": "user", "content": prompt_text}]
    return tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)


def load_model(model_path: str, base_model_name: Optional[str] = None):
    """
    Load a fine-tuned model.

    If model_path contains LoRA adapters, load base model + PEFT adapter.
    """
    tokenizer = AutoTokenizer.from_pretrained(
        model_path if base_model_name is None else base_model_name,
        trust_remote_code=True,
    )

    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # Check if this is a full model or LoRA adapters
    adapter_config = Path(model_path) / "adapter_config.json"
    if adapter_config.exists():
        logger.info(f"Loading LoRA adapters from {model_path}")
        base_name = base_model_name or "HuggingFaceTB/SmolLM2-135M-Instruct"
        model = AutoModelForCausalLM.from_pretrained(
            base_name,
            dtype=torch.float32,
            device_map="cpu",
            trust_remote_code=True,
        )
        model = PeftModel.from_pretrained(model, model_path)
        model = model.merge_and_unload()  # Merge for faster inference
    else:
        logger.info(f"Loading full model from {model_path}")
        model = AutoModelForCausalLM.from_pretrained(
            model_path,
            dtype=torch.float32,
            device_map="cpu",
            trust_remote_code=True,
        )

    model.eval()
    return model, tokenizer


def generate_response(model, tokenizer, prompt: str, max_new_tokens: int = 20) -> str:
    """Generate a response from the model."""
    formatted = build_chat_prompt(prompt, tokenizer)
    inputs = tokenizer(formatted, return_tensors="pt")
    device = next(model.parameters()).device
    inputs = {k: v.to(device) for k, v in inputs.items()}

    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            temperature=0.1,
            do_sample=False,
            pad_token_id=tokenizer.pad_token_id,
        )

    response = tokenizer.decode(
        outputs[0][inputs["input_ids"].shape[1]:],
        skip_special_tokens=True,
    ).strip()

    # Clean up response - take only first line or numeric part
    response = response.split("\n")[0].strip()

    return response


def normalize_answer(text: str) -> str:
    """Normalize answer for comparison."""
    # Strip punctuation and whitespace, lowercase
    text = text.strip().lower().rstrip(".")
    # For numeric answers, extract the number
    nums = re.findall(r"\d+", text)
    if nums:
        return nums[0]
    return text


def eval_counting(model, tokenizer, tests: List[Tuple[str, str]]) -> Dict:
    """Evaluate on counting problems."""
    results = []
    correct = 0
    total = len(tests)

    print("\n" + "=" * 60)
    print("COUNTING EVALUATION")
    print("=" * 60)

    for prompt, expected in tests:
        response = generate_response(model, tokenizer, prompt)
        normalized = normalize_answer(response)
        is_correct = normalized == expected

        status = "✓" if is_correct else "✗"
        print(f"  {status} Q: {prompt}")
        print(f"       Expected: '{expected}'  Got: '{response}'")

        results.append({
            "prompt": prompt,
            "expected": expected,
            "got": response,
            "correct": is_correct,
        })

        if is_correct:
            correct += 1

    accuracy = correct / total * 100
    print(f"\n  Accuracy: {correct}/{total} = {accuracy:.1f}%")

    return {
        "accuracy": accuracy,
        "correct": correct,
        "total": total,
        "results": results,
    }


def eval_general(model, tokenizer, tests: List[Tuple[str, str]]) -> Dict:
    """Evaluate on general instruction following (check for catastrophic forgetting)."""
    results = []
    correct = 0
    total = len(tests)

    print("\n" + "=" * 60)
    print("GENERAL INSTRUCTION EVALUATION")
    print("=" * 60)

    for prompt, expected_keyword in tests:
        response = generate_response(model, tokenizer, prompt)
        normalized = normalize_answer(response)
        expected_norm = normalize_answer(expected_keyword)
        is_correct = expected_norm in normalized or normalized == expected_norm

        status = "✓" if is_correct else "✗"
        print(f"  {status} Q: {prompt}")
        print(f"       Expected contains: '{expected_keyword}'  Got: '{response}'")

        results.append({
            "prompt": prompt,
            "expected_keyword": expected_keyword,
            "got": response,
            "correct": is_correct,
        })

        if is_correct:
            correct += 1

    accuracy = correct / total * 100
    print(f"\n  Accuracy: {correct}/{total} = {accuracy:.1f}%")

    return {
        "accuracy": accuracy,
        "correct": correct,
        "total": total,
        "results": results,
    }


def eval_datagen_accuracy(model, tokenizer, num_samples: int = 200) -> Dict:
    """
    Evaluate on randomly generated counting problems from the data generator.
    This provides a more thorough evaluation than hand-crafted tests.
    """
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from data.generate import generate_dataset

    data = generate_dataset(
        num_examples=num_samples,
        seed=999,
        general_ratio=0.0,  # Pure counting for this eval
    )

    results = []
    correct = 0
    total = len(data)

    print("\n" + "=" * 60)
    print(f"DATA GENERATOR EVALUATION ({num_samples} random samples)")
    print("=" * 60)

    for ex in data:
        response = generate_response(model, tokenizer, ex["prompt"])
        normalized = normalize_answer(response)
        expected = ex["answer"]
        is_correct = normalized == expected

        if not is_correct:
            print(f"  ✗ Q: {ex['prompt']}")
            print(f"     Expected: '{expected}'  Got: '{response}'")

        results.append({
            "prompt": ex["prompt"],
            "expected": expected,
            "got": response,
            "correct": is_correct,
        })

        if is_correct:
            correct += 1

    accuracy = correct / total * 100
    print(f"\n  Accuracy: {correct}/{total} = {accuracy:.1f}%")

    return {
        "accuracy": accuracy,
        "correct": correct,
        "total": total,
        "results": results,
    }


def main():
    parser = argparse.ArgumentParser(description="Evaluate character counting model")
    parser.add_argument("--model-path", type=str, required=True,
                        help="Path to fine-tuned model or adapters")
    parser.add_argument("--base-model", type=str, default=None,
                        help="Base model name (required if loading LoRA adapters)")
    parser.add_argument("--num-samples", type=int, default=200,
                        help="Number of random samples for data generator eval")
    parser.add_argument("--output", type=str, default=None,
                        help="Output JSON file for detailed results")
    args = parser.parse_args()

    # Load model
    model, tokenizer = load_model(args.model_path, args.base_model)

    # Run evaluations
    results = {}

    counting_results = eval_counting(model, tokenizer, COUNTING_TESTS)
    results["counting"] = counting_results

    general_results = eval_general(model, tokenizer, GENERAL_TESTS)
    results["general"] = general_results

    datagen_results = eval_datagen_accuracy(model, tokenizer, args.num_samples)
    results["datagen"] = datagen_results

    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  Counting (hand-crafted): {counting_results['accuracy']:.1f}% ({counting_results['correct']}/{counting_results['total']})")
    print(f"  General instruction:     {general_results['accuracy']:.1f}% ({general_results['correct']}/{general_results['total']})")
    print(f"  Counting (random):       {datagen_results['accuracy']:.1f}% ({datagen_results['correct']}/{datagen_results['total']})")

    overall = (counting_results["correct"] + general_results["correct"] + datagen_results["correct"]) / \
              (counting_results["total"] + general_results["total"] + datagen_results["total"]) * 100
    print(f"  Overall:                 {overall:.1f}%")

    # Save detailed results
    if args.output:
        with open(args.output, "w") as f:
            json.dump(results, f, indent=2)
        print(f"\nDetailed results saved to {args.output}")


if __name__ == "__main__":
    main()
