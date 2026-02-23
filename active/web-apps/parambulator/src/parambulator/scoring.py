from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Set, Tuple

from .models import Chart, Person


@dataclass(frozen=True)
class ScoreBreakdown:
    overall: float
    reading_mix: float
    talkative_spacing: float
    iep_front: float
    avoid_pairs: float
    must_sit_by: float


@dataclass(frozen=True)
class ChartResult:
    chart: Chart
    breakdown: ScoreBreakdown
    warnings: List[str]
    attempt_charts: List[Chart] = field(default_factory=list)


def generate_best_chart(
    people: List[Person],
    rows: int,
    cols: int,
    iterations: int = 200,
    seed: Optional[int] = None,
    layout: Optional[List[List[bool]]] = None,
    pinned_seats: Optional[Dict[Tuple[int, int], str]] = None,
) -> ChartResult:
    warnings: List[str] = []
    if rows <= 0 or cols <= 0:
        raise ValueError("Rows and columns must be positive.")

    layout = _ensure_layout(layout, rows, cols)
    seat_count = sum(1 for row in layout for seat in row if seat)
    names = [person.name for person in people]
    if len(names) > seat_count:
        warnings.append("More people than seats; extra people are omitted.")
        names = names[:seat_count]

    valid_names = set(names)
    pinned = _normalize_pinned_seats(pinned_seats, layout, rows, cols, valid_names, warnings)
    available_names = [name for name in names if name not in set(pinned.values())]

    rng = random.Random(seed)
    best_chart = _build_chart(available_names, layout, pinned)
    best_score = score_chart(best_chart, people, rows, cols)
    attempt_charts: List[Chart] = [best_chart]

    for _ in range(max(1, iterations)):
        candidate_names = list(available_names)
        rng.shuffle(candidate_names)
        candidate = _build_chart(candidate_names, layout, pinned)
        attempt_charts.append(candidate)
        candidate_score = score_chart(candidate, people, rows, cols)
        if candidate_score.overall > best_score.overall:
            best_chart = candidate
            best_score = candidate_score

    return ChartResult(
        chart=best_chart,
        breakdown=best_score,
        warnings=warnings,
        attempt_charts=attempt_charts,
    )


def score_chart(chart: Chart, people: Iterable[Person], rows: int, cols: int) -> ScoreBreakdown:
    people_by_name = {person.name: person for person in people}
    chart_rows, chart_cols = _chart_dimensions(chart, rows, cols)

    adjacency_pairs = _adjacent_pairs(chart, chart_rows, chart_cols)
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
            if chart_rows <= 1:
                iep_scores.append(1.0)
            else:
                iep_scores.append(1.0 - (row_index / (chart_rows - 1)))

    iep_front = 1.0 if not iep_scores else sum(iep_scores) / len(iep_scores)

    avoid_pairs = _avoid_pairs(people_by_name)
    avoid_violations = 0
    for left, right in adjacency_pairs:
        if (left, right) in avoid_pairs or (right, left) in avoid_pairs:
            avoid_violations += 1
    avoid_score = 1.0 if not avoid_pairs else 1.0 - (avoid_violations / len(avoid_pairs))

    must_sit_by_pairs = _must_sit_by_pairs(people_by_name)
    adjacent_pair_set = set(adjacency_pairs)
    must_sit_by_matches = 0
    for left, right in must_sit_by_pairs:
        if (left, right) in adjacent_pair_set or (right, left) in adjacent_pair_set:
            must_sit_by_matches += 1
    must_sit_by_score = (
        1.0 if not must_sit_by_pairs else must_sit_by_matches / len(must_sit_by_pairs)
    )

    weights = {
        "reading_mix": 0.3,
        "talkative_spacing": 0.2,
        "iep_front": 0.2,
        "avoid_pairs": 0.15,
        "must_sit_by": 0.15,
    }
    overall = (
        reading_mix * weights["reading_mix"]
        + talkative_spacing * weights["talkative_spacing"]
        + iep_front * weights["iep_front"]
        + avoid_score * weights["avoid_pairs"]
        + must_sit_by_score * weights["must_sit_by"]
    )

    return ScoreBreakdown(
        overall=round(overall, 4),
        reading_mix=round(reading_mix, 4),
        talkative_spacing=round(talkative_spacing, 4),
        iep_front=round(iep_front, 4),
        avoid_pairs=round(avoid_score, 4),
        must_sit_by=round(must_sit_by_score, 4),
    )


def seat_constraint_statuses(
    chart: Chart, people: Iterable[Person], rows: int, cols: int
) -> List[List[List[Dict[str, str]]]]:
    people_by_name = {person.name: person for person in people}
    chart_rows, chart_cols = _chart_dimensions(chart, rows, cols)
    front_threshold = max(0, (chart_rows - 1) // 2)

    statuses: List[List[List[Dict[str, str]]]] = []
    for row_index in range(chart_rows):
        row_statuses: List[List[Dict[str, str]]] = []
        for col_index in range(chart_cols):
            if row_index >= len(chart) or col_index >= len(chart[row_index]):
                row_statuses.append([])
                continue
            name = chart[row_index][col_index]
            if not name:
                row_statuses.append([])
                continue

            person = people_by_name.get(name)
            neighbors = _adjacent_names(chart, row_index, col_index)

            reading_met = True
            if person:
                reading_met = all(
                    _reading_level(people_by_name, neighbor) != person.reading_level
                    for neighbor in neighbors
                )

            talkative_met = True
            if person and person.talkative:
                talkative_met = not any(_is_talkative(people_by_name, n) for n in neighbors)

            avoid_met = True
            if person and person.avoid:
                avoid_met = not any(neighbor in person.avoid for neighbor in neighbors)

            must_sit_by_met = True
            if person and person.must_sit_by:
                must_sit_by_met = any(neighbor in person.must_sit_by for neighbor in neighbors)

            iep_met = True
            if person and person.iep_front:
                iep_met = row_index <= front_threshold

            row_statuses.append(
                [
                    {
                        "label": "Reading mix",
                        "status": "met" if reading_met else "not met",
                    },
                    {
                        "label": "Talkative spacing",
                        "status": "met" if talkative_met else "not met",
                    },
                    {
                        "label": "Front priority",
                        "status": "met" if iep_met else "not met",
                    },
                    {
                        "label": "Avoid pairs",
                        "status": "met" if avoid_met else "not met",
                    },
                    {
                        "label": "Must sit by",
                        "status": "met" if must_sit_by_met else "not met",
                    },
                ]
            )
        statuses.append(row_statuses)
    return statuses


def _build_chart(
    names: List[str], layout: List[List[bool]], pinned: Optional[Dict[Tuple[int, int], str]] = None
) -> Chart:
    pinned = pinned or {}
    chart: Chart = []
    index = 0
    for row_index, layout_row in enumerate(layout):
        chart_row: List[Optional[str]] = []
        for col_index, seat in enumerate(layout_row):
            if not seat:
                chart_row.append(None)
                continue
            pinned_name = pinned.get((row_index, col_index))
            if pinned_name:
                chart_row.append(pinned_name)
                continue
            if index < len(names):
                chart_row.append(names[index])
                index += 1
            else:
                chart_row.append(None)
        chart.append(chart_row)
    return chart


def _ensure_layout(
    layout: Optional[List[List[bool]]], rows: int, cols: int
) -> List[List[bool]]:
    if layout:
        return layout
    return [[True for _ in range(cols)] for _ in range(rows)]


def _normalize_pinned_seats(
    pinned_seats: Optional[Dict[Tuple[int, int], str]],
    layout: List[List[bool]],
    rows: int,
    cols: int,
    valid_names: Set[str],
    warnings: List[str],
) -> Dict[Tuple[int, int], str]:
    if not pinned_seats:
        return {}

    normalized: Dict[Tuple[int, int], str] = {}
    pinned_names: Set[str] = set()
    for (row_index, col_index), name in pinned_seats.items():
        if row_index < 0 or col_index < 0 or row_index >= rows or col_index >= cols:
            warnings.append(f"Ignored pinned seat for {name}: seat is outside layout bounds.")
            continue
        if row_index >= len(layout) or col_index >= len(layout[row_index]) or not layout[row_index][col_index]:
            warnings.append(f"Ignored pinned seat for {name}: seat is disabled.")
            continue
        if name not in valid_names:
            warnings.append(f"Ignored pinned seat for {name}: student is not in the current roster.")
            continue
        if name in pinned_names:
            warnings.append(f"Ignored duplicate pin for {name}: student can only be pinned once.")
            continue
        normalized[(row_index, col_index)] = name
        pinned_names.add(name)
    return normalized


def _adjacent_pairs(chart: Chart, rows: int, cols: int) -> List[Tuple[str, str]]:
    pairs: List[Tuple[str, str]] = []
    for row in range(rows):
        if row >= len(chart):
            continue
        for col in range(cols):
            if col >= len(chart[row]):
                continue
            name = chart[row][col]
            if name is None:
                continue
            if col + 1 < cols and col + 1 < len(chart[row]) and chart[row][col + 1] is not None:
                pairs.append((name, chart[row][col + 1]))
            if row + 1 < rows and row + 1 < len(chart) and col < len(chart[row + 1]) and chart[row + 1][col] is not None:
                pairs.append((name, chart[row + 1][col]))
    return pairs


def _adjacent_names(chart: Chart, row: int, col: int) -> List[str]:
    neighbors: List[str] = []
    positions = [(row - 1, col), (row + 1, col), (row, col - 1), (row, col + 1)]
    for r, c in positions:
        if r < 0 or c < 0 or r >= len(chart):
            continue
        if c >= len(chart[r]):
            continue
        name = chart[r][c]
        if name is not None:
            neighbors.append(name)
    return neighbors


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


def _must_sit_by_pairs(people: Dict[str, Person]) -> List[Tuple[str, str]]:
    pairs: List[Tuple[str, str]] = []
    for name, person in people.items():
        for must_sit_by_name in person.must_sit_by:
            if must_sit_by_name in people:
                pairs.append((name, must_sit_by_name))
    return pairs


def _chart_dimensions(chart: Chart, fallback_rows: int, fallback_cols: int) -> Tuple[int, int]:
    if not chart:
        return fallback_rows, fallback_cols
    row_count = len(chart)
    col_count = max((len(row) for row in chart), default=fallback_cols)
    return row_count, col_count
