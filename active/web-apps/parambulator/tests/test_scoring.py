from parambulator.models import Person
from parambulator.scoring import generate_best_chart, score_chart, seat_constraint_statuses


def test_generate_best_chart_handles_sparse_layout():
    people = [
        Person("A", "low"),
        Person("B", "medium"),
        Person("C", "high"),
        Person("D", "low"),
    ]
    layout = [
        [True, False, True],
        [True, True, False],
    ]

    result = generate_best_chart(people, rows=2, cols=3, iterations=10, layout=layout)

    assert len(result.chart) == 2
    assert len(result.chart[0]) == 3
    assert result.breakdown.overall >= 0.0


def test_score_chart_uses_chart_dimensions():
    people = [Person("A", "low"), Person("B", "high")]
    chart = [["A"], ["B", None]]

    breakdown = score_chart(chart, people, rows=4, cols=4)

    assert 0.0 <= breakdown.overall <= 1.0


def test_seat_constraint_statuses_reports_met_and_not_met():
    people = [
        Person("A", "low", talkative=True, iep_front=True, avoid=["B"], must_sit_by=["B"]),
        Person("B", "low", talkative=True),
    ]
    chart = [["A", "B"]]

    statuses = seat_constraint_statuses(chart, people, rows=1, cols=2)

    seat_statuses = statuses[0][0]
    status_map = {item["label"]: item["status"] for item in seat_statuses}

    assert status_map["Reading mix"] == "not met"
    assert status_map["Talkative spacing"] == "not met"
    assert status_map["Avoid pairs"] == "not met"
    assert status_map["Must sit by"] == "met"
    assert status_map["Front priority"] == "met"


def test_generate_best_chart_respects_pinned_seats():
    people = [
        Person("A", "low"),
        Person("B", "medium"),
        Person("C", "high"),
        Person("D", "low"),
    ]
    layout = [[True, True], [True, True]]

    result = generate_best_chart(
        people,
        rows=2,
        cols=2,
        iterations=25,
        layout=layout,
        pinned_seats={(0, 1): "C"},
    )

    assert result.chart[0][1] == "C"


def test_score_chart_supports_must_sit_by_metric():
    people = [Person("A", "low", must_sit_by=["B"]), Person("B", "high")]
    chart = [["A", "B"]]

    breakdown = score_chart(chart, people, rows=1, cols=2)

    assert breakdown.must_sit_by == 1.0


def test_score_chart_respects_custom_weights():
    people = [Person("A", "low", avoid=["B"]), Person("B", "low")]
    chart = [["A", "B"]]

    breakdown = score_chart(
        chart,
        people,
        rows=1,
        cols=2,
        weights={
            "reading_mix": 0.0,
            "talkative_spacing": 0.0,
            "iep_front": 0.0,
            "avoid_pairs": 1.0,
            "must_sit_by": 0.0,
        },
    )

    assert breakdown.avoid_pairs == 0.0
    assert breakdown.overall == 0.0


def test_score_chart_falls_back_when_all_weights_are_zero():
    people = [Person("A", "low"), Person("B", "high")]
    chart = [["A", "B"]]

    breakdown = score_chart(
        chart,
        people,
        rows=1,
        cols=2,
        weights={
            "reading_mix": 0.0,
            "talkative_spacing": 0.0,
            "iep_front": 0.0,
            "avoid_pairs": 0.0,
            "must_sit_by": 0.0,
        },
    )

    assert 0.0 <= breakdown.overall <= 1.0
