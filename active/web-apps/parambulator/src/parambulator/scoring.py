from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Tuple

from .models import Chart, Person


@dataclass(frozen=True)
class ScoreBreakdown:
    overall: float
    reading_mix: float
    talkative_spacing: float
    iep_front: float
    avoid_pairs: float


@dataclass(frozen=True)
class ChartResult:
    chart: Chart
    breakdown: ScoreBreakdown
    warnings: List[str]


def generate_best_chart(
    people: List[Person],
    rows: int,
    cols: int,
    iterations: int = 200,
    seed: Optional[int] = None,
) -> ChartResult:
    warnings: List[str] = []
    if rows <= 0 or cols <= 0:
        raise ValueError("Rows and columns must be positive.")

    seat_count = rows * cols
    names = [person.name for person in people]
    if len(names) > seat_count:
        warnings.append("More people than seats; extra people are omitted.")
        names = names[:seat_count]

    rng = random.Random(seed)
    best_chart: Chart = _build_chart(names, rows, cols)
    best_score = score_chart(best_chart, people, rows, cols)

    for _ in range(max(1, iterations)):
        rng.shuffle(names)
        candidate = _build_chart(names, rows, cols)
        candidate_score = score_chart(candidate, people, rows, cols)
        if candidate_score.overall > best_score.overall:
            best_chart = candidate
            best_score = candidate_score

    return ChartResult(chart=best_chart, breakdown=best_score, warnings=warnings)


def score_chart(chart: Chart, people: Iterable[Person], rows: int, cols: int) -> ScoreBreakdown:
    people_by_name = {person.name: person for person in people}

    adjacency_pairs = _adjacent_pairs(chart, rows, cols)
    total_pairs = len(adjacency_pairs)

    reading_matches = 0
    talkative_conflicts = 0
    for left, right in adjacency_pairs:
        if _reading_level(people_by_name, left) == _reading_level(people_by_name, right):
            reading_matches += 1
        if _is_talkative(people_by_name, left) and _is_talkative(people_by_name, right):
            talkative_conflicts += 1

    reading_mix = 1.0 if total_pairs == 0 else 1.0 - (reading_matches / total_pairs)
    talkative_spacing = 1.0 if total_pairs == 0 else 1.0 - (talkative_conflicts / total_pairs)

    iep_scores: List[float] = []
    for position, name in _seat_positions(chart):
        person = people_by_name.get(name)
        if person and person.iep_front:
            row_index, _ = position
            if rows <= 1:
                iep_scores.append(1.0)
            else:
                iep_scores.append(1.0 - (row_index / (rows - 1)))

    iep_front = 1.0 if not iep_scores else sum(iep_scores) / len(iep_scores)

    avoid_pairs = _avoid_pairs(people_by_name)
    avoid_violations = 0
    for left, right in adjacency_pairs:
        if (left, right) in avoid_pairs or (right, left) in avoid_pairs:
            avoid_violations += 1
    avoid_score = 1.0 if not avoid_pairs else 1.0 - (avoid_violations / len(avoid_pairs))

    weights = {
        "reading_mix": 0.35,
        "talkative_spacing": 0.25,
        "iep_front": 0.25,
        "avoid_pairs": 0.15,
    }
    overall = (
        reading_mix * weights["reading_mix"]
        + talkative_spacing * weights["talkative_spacing"]
        + iep_front * weights["iep_front"]
        + avoid_score * weights["avoid_pairs"]
    )

    return ScoreBreakdown(
        overall=round(overall, 4),
        reading_mix=round(reading_mix, 4),
        talkative_spacing=round(talkative_spacing, 4),
        iep_front=round(iep_front, 4),
        avoid_pairs=round(avoid_score, 4),
    )


def _build_chart(names: List[str], rows: int, cols: int) -> Chart:
    chart: Chart = []
    index = 0
    for _ in range(rows):
        row: List[Optional[str]] = []
        for _ in range(cols):
            if index < len(names):
                row.append(names[index])
                index += 1
            else:
                row.append(None)
        chart.append(row)
    return chart


def _adjacent_pairs(chart: Chart, rows: int, cols: int) -> List[Tuple[str, str]]:
    pairs: List[Tuple[str, str]] = []
    for row in range(rows):
        for col in range(cols):
            name = chart[row][col]
            if name is None:
                continue
            if col + 1 < cols and chart[row][col + 1] is not None:
                pairs.append((name, chart[row][col + 1]))
            if row + 1 < rows and chart[row + 1][col] is not None:
                pairs.append((name, chart[row + 1][col]))
    return pairs


def _seat_positions(chart: Chart) -> Iterable[Tuple[Tuple[int, int], str]]:
    for row_index, row in enumerate(chart):
        for col_index, name in enumerate(row):
            if name is None:
                continue
            yield (row_index, col_index), name


def _reading_level(people: Dict[str, Person], name: str) -> str:
    person = people.get(name)
    return person.reading_level if person else "unknown"


def _is_talkative(people: Dict[str, Person], name: str) -> bool:
    person = people.get(name)
    return bool(person and person.talkative)


def _avoid_pairs(people: Dict[str, Person]) -> List[Tuple[str, str]]:
    pairs: List[Tuple[str, str]] = []
    for name, person in people.items():
        for avoid_name in person.avoid:
            if avoid_name in people:
                pairs.append((name, avoid_name))
    return pairs
