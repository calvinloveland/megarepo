import random

import pytest

import vroomon.population.population as pop
from vroomon.population.population import mutate


class DummyFramePart:
    @classmethod
    def from_random(cls):
        return "F"


class DummyPowertrainPart:
    @classmethod
    def from_random(cls):
        return "P"


class DummyCar:
    def __init__(self, frame, powertrain):
        self.frame = list(frame)
        self.powertrain = list(powertrain)


@pytest.fixture(autouse=True)
def patch_parts(monkeypatch):
    # mutate() resolves the part lists through _runtime_dependencies()
    # (imported from the car submodules), not module attrs. Patch the
    # resolver so random.choice always picks Dummy parts and DummyCar is
    # kept OUT of the "real Car" fast path (car_class is an unrelated type).
    _not_car = type("_NotRealCar", (), {})

    def fake_runtime_dependencies():
        return (_not_car, [DummyFramePart], [DummyPowertrainPart], object(), object())

    monkeypatch.setattr(pop, "_runtime_dependencies", fake_runtime_dependencies)


def test_replace_branch(monkeypatch):
    # Always replace both parts when r < replace_p (replace_p=0.10)
    monkeypatch.setattr(random, "random", lambda: 0.0)
    car = DummyCar(frame=[1, 2, 3], powertrain=[4, 5, 6])
    result = mutate(car)
    # Should replace all positions with 'F' and 'P'
    assert result is car
    assert result.frame == ["F", "F", "F"]
    assert result.powertrain == ["P", "P", "P"]


def test_remove_branch(monkeypatch):
    # First call triggers remove (r between 0.10 and 0.15), then leave
    seq = iter([0.12, 1.0, 1.0])
    monkeypatch.setattr(random, "random", lambda: next(seq))
    car = DummyCar(frame=[1, 2, 3], powertrain=[4, 5, 6])
    result = mutate(car)
    # One pair removed: lengths drop by 1
    assert len(result.frame) == 2
    assert len(result.powertrain) == 2
    # Remaining items should be original except removed index
    assert result.frame == [2, 3]
    assert result.powertrain == [5, 6]


def test_insert_branch(monkeypatch):
    # First call triggers insert (r between 0.15 and 0.20), then leave for subsequent iterations
    seq = iter([0.17] + [1.0] * 10)
    monkeypatch.setattr(random, "random", lambda: next(seq))
    car = DummyCar(frame=[1, 2, 3], powertrain=[4, 5, 6])
    result = mutate(car)
    # One pair inserted: lengths increase by 1
    assert len(result.frame) == 4
    assert len(result.powertrain) == 4
    # Inserted 'F','P' at start
    assert result.frame[0] == "F"
    assert result.powertrain[0] == "P"
    # Original first moves to index 1
    assert result.frame[1] == 1
    assert result.powertrain[1] == 4
