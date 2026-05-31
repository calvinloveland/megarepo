"""
Unit tests for the data generator and counting logic.
"""

import pytest
import json
import random
from pathlib import Path
from typing import Dict, List

# Ensure we can import from the project root
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from data.generate import (
    count_char,
    generate_counting_example,
    generate_dataset,
    generate_word_example,
    generate_zero_count_example,
    generate_all_same_example,
    generate_numeric_example,
    generate_special_char_example,
    generate_unicode_example,
    prepare_dpo_pairs,
    COMMON_WORDS,
    REPEAT_RICH_WORDS,
    NUMERIC_STRINGS,
)


class TestCountChar:
    """Test the core counting logic."""

    def test_basic_count(self):
        assert count_char("strawberry", "r") == 3
        assert count_char("banana", "a") == 3
        assert count_char("apple", "p") == 2
        assert count_char("mississippi", "s") == 4

    def test_zero_count(self):
        assert count_char("apple", "z") == 0
        assert count_char("banana", "q") == 0

    def test_case_sensitive(self):
        assert count_char("Apple", "A") == 1
        assert count_char("Apple", "a") == 0  # case sensitive by default
        assert count_char("Strawberry", "S") == 1

    def test_digits(self):
        assert count_char("314159", "1") == 2
        assert count_char("10000000000", "0") == 10
        assert count_char("12345", "5") == 1

    def test_special_chars(self):
        assert count_char("hello-world", "-") == 1
        assert count_char("a_b_c", "_") == 2
        assert count_char("don't", "'") == 1

    def test_unicode(self):
        assert count_char("café", "é") == 1
        assert count_char("naïve", "ï") == 1
        assert count_char("jalapeño", "ñ") == 1

    def test_empty_string(self):
        assert count_char("", "a") == 0

    def test_all_same(self):
        assert count_char("aaaaa", "a") == 5
        assert count_char("bbb", "b") == 3


class TestGenerateCountingExample:
    """Test the example generation."""

    def test_generates_valid_example(self):
        ex = generate_counting_example("strawberry", "r")
        assert "prompt" in ex
        assert "answer" in ex
        assert "word" in ex
        assert "char" in ex
        assert "count" in ex
        assert ex["answer"] == "3"
        assert ex["count"] == 3

    def test_answer_matches_count(self):
        for word in ["apple", "banana", "mississippi", "grape"]:
            for char in set(word):
                ex = generate_counting_example(word, char)
                assert ex["answer"] == str(ex["count"])
                assert ex["answer"] == str(word.count(char))

    def test_varying_templates(self):
        """Different templates should produce different prompts."""
        prompts = set()
        for _ in range(50):
            ex = generate_counting_example("strawberry", "r")
            prompts.add(ex["prompt"])
        # Should have multiple templates
        assert len(prompts) > 1, "Only one template was used"


class TestGenerateDataset:
    """Test the full dataset generation."""

    def test_generates_correct_number(self):
        data = generate_dataset(num_examples=100, seed=42, include_general=False)
        assert len(data) == 100

    def test_all_have_prompt_and_answer(self):
        data = generate_dataset(num_examples=500, seed=42)
        for ex in data:
            assert "prompt" in ex
            assert "answer" in ex

    def test_general_data_included(self):
        data = generate_dataset(num_examples=1000, seed=42, include_general=True, general_ratio=0.2)
        counting = [ex for ex in data if "count" in ex]
        general = [ex for ex in data if "count" not in ex]
        assert len(general) > 0, "No general examples included"
        assert len(counting) > len(general), "Counting examples should dominate"

    def test_reproducible(self):
        data1 = generate_dataset(num_examples=100, seed=42)
        data2 = generate_dataset(num_examples=100, seed=42)
        assert data1 == data2

    def test_different_seeds_give_different_data(self):
        data1 = generate_dataset(num_examples=100, seed=1)
        data2 = generate_dataset(num_examples=100, seed=2)
        # They might have some overlap by chance, but should not be identical
        assert data1 != data2

    def test_zero_count_examples_exist(self):
        data = generate_dataset(num_examples=1000, seed=42, include_general=False)
        zeros = [ex for ex in data if ex["count"] == 0]
        assert len(zeros) > 0, "No zero-count examples in dataset"

    def test_numeric_examples_exist(self):
        data = generate_dataset(num_examples=1000, seed=42, include_general=False)
        digit_examples = [ex for ex in data if any(c.isdigit() for c in ex.get("word", ""))]
        assert len(digit_examples) > 0, "No numeric examples in dataset"


class TestPrepareDPOPairs:
    """Test DPO pair preparation."""

    def test_generates_pairs(self):
        data = generate_dataset(num_examples=100, seed=42, include_general=False)
        pairs = prepare_dpo_pairs(data, seed=42)
        assert len(pairs) == len(data)

    def test_pair_format(self):
        data = generate_dataset(num_examples=10, seed=42, include_general=False)
        pairs = prepare_dpo_pairs(data, seed=42)
        for pair in pairs:
            assert "prompt" in pair
            assert "chosen" in pair
            assert "rejected" in pair
            # Chosen should be correct
            assert pair["chosen"].lstrip("-").isdigit()

    def test_chosen_is_correct(self):
        data = generate_dataset(num_examples=100, seed=42, include_general=False)
        pairs = prepare_dpo_pairs(data, seed=42)
        for pair, original in zip(pairs, data):
            if "count" in original:
                assert pair["chosen"] == str(original["count"])

    def test_rejected_differs_from_chosen(self):
        data = generate_dataset(num_examples=100, seed=42, include_general=False)
        pairs = prepare_dpo_pairs(data, seed=42)
        for pair in pairs:
            assert pair["chosen"] != pair["rejected"], \
                f"Chosen and rejected are identical: {pair}"


class TestEdgeCases:
    """Test edge cases in counting."""

    def test_all_same_generation(self):
        ex = generate_all_same_example()
        assert ex["count"] == len(ex["word"])
        assert ex["word"] == ex["word"][0] * len(ex["word"])

    def test_special_char_generation(self):
        ex = generate_special_char_example()
        assert "word" in ex
        assert "char" in ex
        assert ex["char"] in ex["word"]

    def test_unicode_generation(self):
        ex = generate_unicode_example()
        assert "word" in ex
        assert "char" in ex
        assert ex["char"] in ex["word"]

    def test_numeric_generation(self):
        ex = generate_numeric_example()
        assert "word" in ex
        assert ex["word"].isdigit()
        assert ex["char"].isdigit()

    def test_zero_count_generation(self):
        ex = generate_zero_count_example()
        assert ex["count"] == 0
        assert ex["char"] not in ex["word"]


class TestExportFormat:
    """Test that the dataset can be exported and loaded correctly."""

    def test_jsonl_roundtrip(self, tmp_path):
        data = generate_dataset(num_examples=100, seed=42, include_general=False)
        jsonl_path = tmp_path / "test.jsonl"
        with open(jsonl_path, "w") as f:
            for ex in data:
                f.write(json.dumps(ex) + "\n")

        reloaded = []
        with open(jsonl_path) as f:
            for line in f:
                reloaded.append(json.loads(line))

        assert len(reloaded) == len(data)
        for orig, loaded in zip(data, reloaded):
            assert orig == loaded

    def test_dpo_jsonl_roundtrip(self, tmp_path):
        data = generate_dataset(num_examples=50, seed=42, include_general=False)
        pairs = prepare_dpo_pairs(data, seed=42)
        jsonl_path = tmp_path / "test_dpo.jsonl"
        with open(jsonl_path, "w") as f:
            for pair in pairs:
                f.write(json.dumps(pair) + "\n")

        reloaded = []
        with open(jsonl_path) as f:
            for line in f:
                reloaded.append(json.loads(line))

        assert len(reloaded) == len(pairs)
