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
    weights: Optional[Dict[str, float]] = None,
) -> ChartResult:
    warnings: List[str] = []
    if rows <= 0 or cols <= 0:
        raise ValueError("Rows and columns must be positive.")

    layout = _ensure_layout(layout, rows, cols)
    pinned, unpinned_assignments = _prepare_chart_inputs(
        people, layout, rows, cols, pinned_seats, warnings
    )

    rng = random.Random(seed)
    best_chart = _build_chart(unpinned_assignments, layout, pinned)
    best_score = score_chart(best_chart, people, rows, cols, weights=weights)
    attempt_charts: List[Chart] = [best_chart]

    for _ in range(max(1, iterations)):
        candidate_names = list(unpinned_assignments)
        rng.shuffle(candidate_names)
        candidate = _build_chart(candidate_names, layout, pinned)
        attempt_charts.append(candidate)
        candidate_score = score_chart(candidate, people, rows, cols, weights=weights)
        if candidate_score.overall > best_score.overall:
            best_chart = candidate
            best_score = candidate_score

    return ChartResult(
        chart=best_chart,
        breakdown=best_score,
        warnings=warnings,
        attempt_charts=attempt_charts,
    )


def score_chart(
    chart: Chart,
    people: Iterable[Person],
    rows: int,
    cols: int,
    weights: Optional[Dict[str, float]] = None,
) -> ScoreBreakdown:
    people_by_name = {person.name: person for person in people}
    chart_rows, chart_cols = _chart_dimensions(chart, rows, cols)
    adjacency_pairs = _adjacent_pairs(chart, chart_rows, chart_cols)
    reading_mix, talkative_spacing = _reading_talkative_scores(adjacency_pairs, people_by_name)
    iep_front = _iep_front_score(chart, people_by_name, chart_rows)
    avoid_score = _avoid_score(adjacency_pairs, people_by_name)
    must_sit_by_score = _must_sit_by_score(adjacency_pairs, people_by_name)
    normalized_weights = _normalize_score_weights(weights)
    overall = _weighted_overall(
        reading_mix, talkative_spacing, iep_front, avoid_score, must_sit_by_score, normalized_weights
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
            row_statuses.append(
                _seat_statuses_for_position(
                    chart, people_by_name, row_index, col_index, front_threshold
                )
            )
        statuses.append(row_statuses)
    return statuses


def _build_chart(
    names: List[Optional[str]],
    layout: List[List[bool]],
    pinned: Optional[Dict[Tuple[int, int], str]] = None,
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
        warning = _pinned_seat_warning(
            row_index, col_index, name, layout, rows, cols, valid_names, pinned_names
        )
        if warning:
            warnings.append(warning)
            continue
        normalized[(row_index, col_index)] = name
        pinned_names.add(name)
    return normalized


def _adjacent_pairs(chart: Chart, rows: int, cols: int) -> List[Tuple[str, str]]:
    pairs: List[Tuple[str, str]] = []
    for row in range(rows):
        for col in range(cols):
            name = _chart_name_at(chart, row, col)
            if name is None:
                continue
            for row_delta, col_delta in ((0, 1), (1, 0)):
                neighbor_name = _chart_name_at(chart, row + row_delta, col + col_delta)
                if neighbor_name is not None:
                    pairs.append((name, neighbor_name))
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


def _prepare_chart_inputs(
    people: List[Person],
    layout: List[List[bool]],
    rows: int,
    cols: int,
    pinned_seats: Optional[Dict[Tuple[int, int], str]],
    warnings: List[str],
) -> Tuple[Dict[Tuple[int, int], str], List[Optional[str]]]:
    seat_count = sum(1 for row in layout for seat in row if seat)
    names = [person.name for person in people]
    if len(names) > seat_count:
        warnings.append("More people than seats; extra people are omitted.")
        names = names[:seat_count]

    valid_names = set(names)
    pinned = _normalize_pinned_seats(pinned_seats, layout, rows, cols, valid_names, warnings)
    available_names = [name for name in names if name not in set(pinned.values())]
    unpinned_seat_count = max(0, seat_count - len(pinned))
    assignments: List[Optional[str]] = list(available_names[:unpinned_seat_count])
    if len(assignments) < unpinned_seat_count:
        assignments.extend([None] * (unpinned_seat_count - len(assignments)))
    return pinned, assignments


def _reading_talkative_scores(
    adjacency_pairs: List[Tuple[str, str]],
    people_by_name: Dict[str, Person],
) -> Tuple[float, float]:
    total_pairs = len(adjacency_pairs)
    if total_pairs == 0:
        return 1.0, 1.0
    reading_matches = sum(
        1
        for left, right in adjacency_pairs
        if _reading_level(people_by_name, left) == _reading_level(people_by_name, right)
    )
    talkative_conflicts = sum(
        1
        for left, right in adjacency_pairs
        if _is_talkative(people_by_name, left) and _is_talkative(people_by_name, right)
    )
    return 1.0 - (reading_matches / total_pairs), 1.0 - (talkative_conflicts / total_pairs)


def _iep_front_score(chart: Chart, people_by_name: Dict[str, Person], chart_rows: int) -> float:
    iep_scores: List[float] = []
    for (row_index, _), name in _seat_positions(chart):
        person = people_by_name.get(name)
        if not person or not person.iep_front:
            continue
        if chart_rows <= 1:
            iep_scores.append(1.0)
        else:
            iep_scores.append(1.0 - (row_index / (chart_rows - 1)))
    return 1.0 if not iep_scores else sum(iep_scores) / len(iep_scores)


def _avoid_score(
    adjacency_pairs: List[Tuple[str, str]], people_by_name: Dict[str, Person]
) -> float:
    avoid_pairs = _avoid_pairs(people_by_name)
    if not avoid_pairs:
        return 1.0
    avoid_violations = sum(
        1
        for left, right in adjacency_pairs
        if (left, right) in avoid_pairs or (right, left) in avoid_pairs
    )
    return 1.0 - (avoid_violations / len(avoid_pairs))


def _must_sit_by_score(
    adjacency_pairs: List[Tuple[str, str]], people_by_name: Dict[str, Person]
) -> float:
    required_pairs = _must_sit_by_pairs(people_by_name)
    if not required_pairs:
        return 1.0
    adjacent_pair_set = set(adjacency_pairs)
    matches = sum(
        1
        for left, right in required_pairs
        if (left, right) in adjacent_pair_set or (right, left) in adjacent_pair_set
    )
    return matches / len(required_pairs)


def _normalize_score_weights(weights: Optional[Dict[str, float]]) -> Dict[str, float]:
    defaults = {
        "reading_mix": 0.3,
        "talkative_spacing": 0.2,
        "iep_front": 0.2,
        "avoid_pairs": 0.15,
        "must_sit_by": 0.15,
    }
    normalized = dict(defaults)
    if not weights:
        return normalized
    for key, default_value in defaults.items():
        raw_value = weights.get(key, default_value)
        try:
            normalized[key] = max(0.0, float(raw_value))
        except (TypeError, ValueError):
            normalized[key] = default_value
    return normalized


def _weighted_overall(
    reading_mix: float,
    talkative_spacing: float,
    iep_front: float,
    avoid_score: float,
    must_sit_by_score: float,
    weights: Dict[str, float],
) -> float:
    total_weight = sum(weights.values())
    if total_weight <= 0:
        return (reading_mix + talkative_spacing + iep_front + avoid_score + must_sit_by_score) / 5.0
    return (
        reading_mix * weights["reading_mix"]
        + talkative_spacing * weights["talkative_spacing"]
        + iep_front * weights["iep_front"]
        + avoid_score * weights["avoid_pairs"]
        + must_sit_by_score * weights["must_sit_by"]
    ) / total_weight


def _seat_statuses_for_position(
    chart: Chart,
    people_by_name: Dict[str, Person],
    row_index: int,
    col_index: int,
    front_threshold: int,
) -> List[Dict[str, str]]:
    name = _chart_name_at(chart, row_index, col_index)
    if not name:
        return []

    person = people_by_name.get(name)
    neighbors = _adjacent_names(chart, row_index, col_index)
    reading_met = _reading_constraint_met(person, neighbors, people_by_name)
    talkative_met = _talkative_constraint_met(person, neighbors, people_by_name)
    avoid_met = _avoid_constraint_met(person, neighbors)
    must_sit_by_met = _must_sit_by_constraint_met(person, neighbors)
    iep_met = _front_constraint_met(person, row_index, front_threshold)
    return _status_rows(reading_met, talkative_met, iep_met, avoid_met, must_sit_by_met)


def _reading_constraint_met(
    person: Optional[Person], neighbors: List[str], people_by_name: Dict[str, Person]
) -> bool:
    if not person:
        return True
    return all(_reading_level(people_by_name, neighbor) != person.reading_level for neighbor in neighbors)


def _talkative_constraint_met(
    person: Optional[Person], neighbors: List[str], people_by_name: Dict[str, Person]
) -> bool:
    if not person or not person.talkative:
        return True
    return not any(_is_talkative(people_by_name, neighbor) for neighbor in neighbors)


def _avoid_constraint_met(person: Optional[Person], neighbors: List[str]) -> bool:
    if not person or not person.avoid:
        return True
    return not any(neighbor in person.avoid for neighbor in neighbors)


def _must_sit_by_constraint_met(person: Optional[Person], neighbors: List[str]) -> bool:
    if not person or not person.must_sit_by:
        return True
    return any(neighbor in person.must_sit_by for neighbor in neighbors)


def _front_constraint_met(person: Optional[Person], row_index: int, front_threshold: int) -> bool:
    if not person or not person.iep_front:
        return True
    return row_index <= front_threshold


def _status_rows(
    reading_met: bool,
    talkative_met: bool,
    iep_met: bool,
    avoid_met: bool,
    must_sit_by_met: bool,
) -> List[Dict[str, str]]:
    return [
        {"label": "Reading mix", "status": "met" if reading_met else "not met"},
        {"label": "Talkative spacing", "status": "met" if talkative_met else "not met"},
        {"label": "Front priority", "status": "met" if iep_met else "not met"},
        {"label": "Avoid pairs", "status": "met" if avoid_met else "not met"},
        {"label": "Must sit by", "status": "met" if must_sit_by_met else "not met"},
    ]


def _pinned_seat_warning(
    row_index: int,
    col_index: int,
    name: str,
    layout: List[List[bool]],
    rows: int,
    cols: int,
    valid_names: Set[str],
    pinned_names: Set[str],
) -> Optional[str]:
    if row_index < 0 or col_index < 0 or row_index >= rows or col_index >= cols:
        return f"Ignored pinned seat for {name}: seat is outside layout bounds."
    if row_index >= len(layout) or col_index >= len(layout[row_index]) or not layout[row_index][col_index]:
        return f"Ignored pinned seat for {name}: seat is disabled."
    if name not in valid_names:
        return f"Ignored pinned seat for {name}: student is not in the current roster."
    if name in pinned_names:
        return f"Ignored duplicate pin for {name}: student can only be pinned once."
    return None


def _chart_name_at(chart: Chart, row: int, col: int) -> Optional[str]:
    if row < 0 or col < 0 or row >= len(chart) or col >= len(chart[row]):
        return None
    return chart[row][col]
