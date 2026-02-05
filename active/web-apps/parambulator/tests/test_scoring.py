from parambulator.models import Person
from parambulator.scoring import generate_best_chart, score_chart


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
