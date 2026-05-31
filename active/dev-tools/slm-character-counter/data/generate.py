"""
Synthetic data generator for 'how many X in Y' character counting problems.

Generates diverse training examples covering:
- Letters (lowercase, uppercase, mixed case)
- Digits in numeric strings
- Special characters
- Edge cases: zero occurrences, all-same, single char, empty-like
- Varying word lengths (from short to very long)

Output: JSONL files with 'prompt' and 'answer' fields.
"""

import argparse
import json
import random
import string
import unicodedata
from pathlib import Path
from typing import Dict, List, Optional, Tuple


# ── Word sources ──────────────────────────────────────────────────────────────

COMMON_WORDS = [
    "apple", "banana", "strawberry", "blueberry", "raspberry", "cherry",
    "grape", "orange", "lemon", "lime", "peach", "pear", "plum", "mango",
    "papaya", "kiwi", "melon", "watermelon", "pineapple", "coconut",
    "pumpkin", "potato", "tomato", "broccoli", "spinach", "lettuce",
    "cucumber", "carrot", "celery", "pepper", "onion", "garlic",
    "elephant", "giraffe", "dolphin", "penguin", "butterfly", "dragonfly",
    "grasshopper", "centipede", "chimpanzee", "kangaroo", "platypus",
    "squirrel", "porcupine", "armadillo", "chameleon", "alligator",
    "mississippi", "independence", "responsibility", "unbelievable",
    "extraordinary", "unprecedented", "accommodation", "collaboration",
    "communication", "infrastructure", "recommendation", "representative",
    "supercalifragilisticexpialidocious", "antidisestablishmentarianism",
    "floccinaucinihilipilification", "hippopotomonstrosesquippedaliophobia",
    "pseudopseudohypoparathyroidism",
]

# Words that repeat letters heavily (good for counting)
REPEAT_RICH_WORDS = [
    "strawberry", "banana", "mississippi", "sassafras", "popsicle",
    "bookkeeper", "subbookkeeper", "tattoo", "assess", "assassin",
    "arrhythmia", "bellied", "daffodil", "foofaraw", "guerrilla",
    "hippopotamus", "llama", "mammal", "parallel", "puzzle",
    "queues", "refer", "reverberate", "sassafras", "senselessness",
    "teepee", "tennessee", "unnecessary", "woolliness", "zombie",
]

# Numeric strings (treating digits as characters to count)
NUMERIC_STRINGS = [
    "31415926535",  # pi digits
    "27182818284",  # e digits
    "16180339887",  # golden ratio
    "14142135623",  # sqrt(2)
    "10000000000",
    "12345678900",
    "99999999999",
    "86753095555",
    "42042042042",
    "00700700700",
    "10101010101",
    "11223344556",
    "31415926535897932384626433832795",  # more pi
]

# Words with repeated patterns across cases
CASED_WORDS = [
    "Apple", "Banana", "Strawberry", "Mississippi", "BANANA",
    "STRAWBERRY", "ApPlE", "StRaWbErRy", "BaNaNa",
    "CoCoNuT", "OoOoOoOo", "AbBa", "CaMeLcAsE",
]


# ── Style templates ───────────────────────────────────────────────────────────

QUESTION_TEMPLATES = [
    "How many {char}s are in {word}?",
    "How many {char}s in {word}?",
    "Count the number of {char}s in {word}.",
    "How many times does {char} appear in {word}?",
    "What is the count of {char} in {word}?",
    "How many {char}s does {word} have?",
    "Count all {char}s in {word}.",
    "How many of the letter {char} are in {word}?",
    "How many {char}s can you find in {word}?",
    "Tell me how many {char}s are in {word}.",
]

# Formats that include explicit plural or possessive phrasing
ALTERNATE_TEMPLATES = [
    "How many \"{char}\"s in \"{word}\"?",
    "How many '{char}'s in '{word}'?",
    "Count the occurrences of '{char}' in '{word}'.",
    "How many times is the character '{char}' present in '{word}'?",
]


def count_char(text: str, char: str) -> int:
    """Count occurrences of char in text (case-sensitive)."""
    return text.count(char)


def generate_counting_example(
    word: str,
    char: str,
) -> Dict[str, str]:
    """Generate one (prompt, answer) example for character counting."""
    count = count_char(word, char)
    template = random.choice(QUESTION_TEMPLATES + ALTERNATE_TEMPLATES)
    prompt = template.format(word=word, char=char)
    return {"prompt": prompt, "answer": str(count), "word": word, "char": char, "count": count}


def generate_random_word(min_len: int = 3, max_len: int = 20) -> str:
    """Generate a random pronounceable-looking word."""
    vowels = "aeiou"
    consonants = "bcdfghjklmnpqrstvwxyz"
    length = random.randint(min_len, max_len)
    word = []
    for i in range(length):
        if i % 2 == 0:
            word.append(random.choice(consonants))
        else:
            word.append(random.choice(vowels))
    # Occasionally add repeated chars for interesting counting
    if random.random() < 0.3 and len(word) > 3:
        idx = random.randint(1, len(word) - 2)
        word[idx] = word[idx - 1]
    return "".join(word)


def generate_numeric_example() -> Dict[str, str]:
    """Generate a counting problem with digits in a numeric string."""
    num_str = random.choice(NUMERIC_STRINGS)
    # Pick a random digit present
    digit = random.choice(list(set(num_str)))
    return generate_counting_example(num_str, digit)


def generate_word_example(
    word_pool: List[str],
    char_pool: Optional[List[str]] = None,
) -> Dict[str, str]:
    """Generate a counting problem from a word and a character."""
    word = random.choice(word_pool)
    if char_pool is None:
        # Pick a random character from the word
        char = random.choice(list(set(word.lower() + word.upper())))
    else:
        char = random.choice(char_pool)
    return generate_counting_example(word, char)


def generate_zero_count_example() -> Dict[str, str]:
    """Generate an example where the answer is 0."""
    word = random.choice(COMMON_WORDS + REPEAT_RICH_WORDS)
    # Find a letter NOT in the word
    all_letters = set(string.ascii_lowercase)
    word_letters = set(word.lower())
    available = list(all_letters - word_letters)
    if not available:
        # Fallback: use a special char
        char = random.choice(string.punctuation)
    else:
        char = random.choice(available)
    return generate_counting_example(word, char)


def generate_case_variant(word: str, char: str) -> Dict[str, str]:
    """
    Generate counting problem that tests case sensitivity awareness.
    The prompt asks for a specific case but the word may have mixed case.
    """
    template = random.choice(QUESTION_TEMPLATES + ALTERNATE_TEMPLATES)
    prompt = template.format(word=word, char=char)
    count = count_char(word, char)
    return {"prompt": prompt, "answer": str(count), "word": word, "char": char, "count": count}


def generate_all_same_example() -> Dict[str, str]:
    """Generate a word where all characters are the same."""
    char = random.choice(string.ascii_lowercase)
    length = random.randint(2, 20)
    word = char * length
    return generate_counting_example(word, char)


def generate_special_char_example() -> Dict[str, str]:
    """Generate counting with special characters like hyphens, underscores, spaces."""
    patterns = [
        ("hello-world", "-"),
        ("user_name@domain.com", "@"),
        ("first_last", "_"),
        ("co-oper-ation", "-"),
        ("don't", "'"),
        ("100%", "%"),
        ("3.14", "."),
        ("hello world", " "),
    ]
    word, char = random.choice(patterns)
    return generate_counting_example(word, char)


def generate_unicode_example() -> Dict[str, str]:
    """Generate counting with accented or Unicode characters."""
    examples = [
        ("café", "é"),
        ("naïve", "ï"),
        ("résumé", "é"),
        ("jalapeño", "ñ"),
        ("über cool", "ü"),
        ("ångström", "å"),
        ("München", "ü"),
        ("façade", "ç"),
    ]
    word, char = random.choice(examples)
    return generate_counting_example(word, char)


# ── Dataset generation ────────────────────────────────────────────────────────

def generate_dataset(
    num_examples: int = 10_000,
    seed: int = 42,
    include_general: bool = True,
    general_ratio: float = 0.15,
) -> List[Dict[str, str]]:
    """
    Generate a balanced dataset of character counting problems.

    Args:
        num_examples: Total number of examples to generate.
        seed: Random seed for reproducibility.
        include_general: Whether to include general instruction-following examples.
        general_ratio: Fraction of general (non-counting) examples.

    Returns:
        List of dicts with 'prompt' and 'answer' keys.
    """
    rng = random.Random(seed)
    old_state = random.getstate()
    random.setstate(rng.getstate())

    examples: List[Dict[str, str]] = []

    counting_target = int(num_examples * (1 - general_ratio)) if include_general else num_examples
    general_target = num_examples - counting_target

    # Define example generators with weights for diversity
    generators = [
        # (generator_fn, weight, args)
        (generate_word_example, 35, {"word_pool": COMMON_WORDS}),
        (generate_word_example, 20, {"word_pool": REPEAT_RICH_WORDS}),
        (generate_numeric_example, 10, {}),
        (generate_zero_count_example, 10, {}),
        (generate_all_same_example, 5, {}),
        (generate_special_char_example, 5, {}),
        (generate_unicode_example, 5, {}),
    ]

    # Weighted generator selection
    generators_flat = []
    for gen_fn, weight, kwargs in generators:
        generators_flat.extend([(gen_fn, kwargs)] * weight)

    i = 0
    while i < counting_target:
        gen_fn, kwargs = random.choice(generators_flat)
        ex = gen_fn(**kwargs)
        # De-duplicate near-duplicate prompts
        if not any(e["prompt"] == ex["prompt"] for e in examples):
            examples.append(ex)
            i += 1

    if include_general:
        general_examples = _generate_general_examples(general_target)
        examples.extend(general_examples)

    # Shuffle final dataset
    random.shuffle(examples)
    random.setstate(old_state)

    return examples


def _generate_general_examples(n: int) -> List[Dict[str, str]]:
    """
    Generate simple instruction-following examples to preserve general capabilities.

    These are simple factual Q&A pairs covering common knowledge.
    """
    general_data = [
        {"prompt": "What is the capital of France?", "answer": "Paris"},
        {"prompt": "What is 2 + 2?", "answer": "4"},
        {"prompt": "What color is the sky on a clear day?", "answer": "Blue"},
        {"prompt": "How many days are in a week?", "answer": "7"},
        {"prompt": "What is the largest planet in our solar system?", "answer": "Jupiter"},
        {"prompt": "Who wrote Romeo and Juliet?", "answer": "William Shakespeare"},
        {"prompt": "What is the boiling point of water in Celsius?", "answer": "100"},
        {"prompt": "How many continents are there?", "answer": "7"},
        {"prompt": "What is the square root of 16?", "answer": "4"},
        {"prompt": "What year did World War II end?", "answer": "1945"},
        {"prompt": "What is the chemical symbol for gold?", "answer": "Au"},
        {"prompt": "How many legs does a dog have?", "answer": "4"},
        {"prompt": "What planet is known as the Red Planet?", "answer": "Mars"},
        {"prompt": "What is 10 divided by 2?", "answer": "5"},
        {"prompt": "How many hours in a day?", "answer": "24"},
        {"prompt": "What is the speed of light in m/s?", "answer": "299792458"},
        {"prompt": "What month comes after June?", "answer": "July"},
        {"prompt": "How many sides does a triangle have?", "answer": "3"},
        {"prompt": "What is 15 + 7?", "answer": "22"},
        {"prompt": "How many seconds in a minute?", "answer": "60"},
        {"prompt": "Write a short greeting.", "answer": "Hello, how can I help you today?"},
        {"prompt": "What is 3 * 4?", "answer": "12"},
        {"prompt": "What is the first letter of the alphabet?", "answer": "a"},
        {"prompt": "How many zeros in one thousand?", "answer": "3"},
        {"prompt": "Is water wet?", "answer": "Yes, water is wet."},
        {"prompt": "What is the opposite of hot?", "answer": "Cold"},
        {"prompt": "How many vowels in the word 'apple'?", "answer": "2"},
        {"prompt": "What color are bananas?", "answer": "Yellow"},
        {"prompt": "What is 100 - 1?", "answer": "99"},
        {"prompt": "How many fingers on one hand?", "answer": "5"},
    ]
    # Repeat to reach target (with slight variation)
    result = []
    while len(result) < n:
        for ex in general_data:
            if len(result) >= n:
                break
            # Add slight variation with an alternate template
            if random.random() < 0.3:
                alt_ex = ex.copy()
                alt_ex["prompt"] = ex["prompt"].replace("?", "? Please answer concisely.")
                result.append(alt_ex)
            else:
                result.append(ex)
    return result[:n]


def save_dataset(
    examples: List[Dict[str, str]],
    output_path: Path,
    split: str = "train",
):
    """Save dataset in JSONL format."""
    filepath = output_path / f"{split}.jsonl"
    with open(filepath, "w") as f:
        for ex in examples:
            f.write(json.dumps(ex) + "\n")
    print(f"Saved {len(examples)} examples to {filepath}")


def prepare_dpo_pairs(
    examples: List[Dict[str, str]],
    seed: int = 42,
) -> List[Dict[str, str]]:
    """
    Convert counting examples into DPO preference pairs.

    For each example, the 'chosen' response is the correct answer.
    The 'rejected' response is a plausible wrong answer.

    Returns list of dicts with: prompt, chosen, rejected.
    """
    rng = random.Random(seed)
    dpo_examples = []

    for ex in examples:
        prompt = ex["prompt"]
        correct = ex["answer"]
        word = ex.get("word", "")
        char = ex.get("char", "")
        correct_count = ex.get("count", None)

        # Generate a plausible wrong answer
        rejected = _generate_rejected_answer(correct, correct_count, word, char, rng)

        dpo_examples.append({
            "prompt": prompt,
            "chosen": correct,
            "rejected": rejected,
        })

    return dpo_examples


def _generate_rejected_answer(
    correct: str,
    correct_count: Optional[int],
    word: str,
    char: str,
    rng: random.Random,
) -> str:
    """Generate a plausible but incorrect answer for DPO training.

    Guaranteed to return a value different from `correct`.
    """
    correct_int = int(correct) if correct.isdigit() else None

    if correct_count is not None and correct_count > 0:
        for _ in range(10):  # Retry until we get a different answer
            error_type = rng.choice(["off_by_one", "off_by_one", "half", "double", "random"])
            if error_type == "off_by_one":
                result = correct_count + rng.choice([-1, 1])
            elif error_type == "half":
                # Ensure half != correct: for count=1, use 0 or 2 instead
                half = max(0, correct_count // 2)
                if half == correct_count:
                    half = correct_count + rng.choice([-1, 1])
                result = half or (correct_count + 1)
            elif error_type == "double":
                result = correct_count * 2
                if result == correct_count:
                    result = correct_count + rng.choice([-1, 1])
            else:  # random
                result = rng.randint(0, max(5, len(word) * 2))

            if str(result) != correct:
                return str(result)

        # Fallback: guaranteed different
        return str(correct_count + 1)
    else:
        # For zero-count (correct="0") or unknown, generate a small wrong answer
        candidate = str(rng.randint(1, 5))
        if candidate != correct:
            return candidate
        return "1" if correct != "1" else "2"


def main():
    parser = argparse.ArgumentParser(description="Generate character counting dataset")
    parser.add_argument("--output", type=str, default="data",
                        help="Output directory for dataset files")
    parser.add_argument("--train-examples", type=int, default=10000,
                        help="Number of training examples")
    parser.add_argument("--eval-examples", type=int, default=500,
                        help="Number of evaluation examples")
    parser.add_argument("--seed", type=int, default=42,
                        help="Random seed")
    parser.add_argument("--dpo", action="store_true",
                        help="Also generate DPO preference pairs")
    parser.add_argument("--general-ratio", type=float, default=0.15,
                        help="Fraction of general instruction examples")
    args = parser.parse_args()

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Generating {args.train_examples} training examples...")
    train_data = generate_dataset(
        num_examples=args.train_examples,
        seed=args.seed,
        general_ratio=args.general_ratio,
    )
    save_dataset(train_data, output_dir, "train")

    print(f"Generating {args.eval_examples} evaluation examples...")
    eval_data = generate_dataset(
        num_examples=args.eval_examples,
        seed=args.seed + 1,
        general_ratio=0.0,  # pure counting for eval
    )
    save_dataset(eval_data, output_dir, "eval")

    # Print statistics
    counting = [ex for ex in train_data if "count" in ex]
    zero_count = [ex for ex in counting if ex["count"] == 0]
    print(f"\nDataset stats:")
    print(f"  Total training: {len(train_data)}")
    print(f"  Counting problems: {len(counting)}")
    print(f"  Zero-count examples: {len(zero_count)}")
    print(f"  General QA: {len(train_data) - len(counting)}")

    # Show some examples
    print("\nSample examples:")
    for ex in counting[:5]:
        print(f"  Q: {ex['prompt']}  A: {ex['answer']}")

    if args.dpo:
        print("\nGenerating DPO preference pairs...")
        dpo_data = prepare_dpo_pairs(train_data, seed=args.seed)
        save_dataset(dpo_data, output_dir, "train_dpo")
        for ex in dpo_data[:3]:
            print(f"  Q: {ex['prompt']}")
            print(f"    Chosen:   {ex['chosen']}")
            print(f"    Rejected: {ex['rejected']}")
            print()


if __name__ == "__main__":
    main()
