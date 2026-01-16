import random

import pytest

from vroomon.population.population import reproduce


class DummyCar:
    def __init__(self, frame, powertrain):
        self.frame = list(frame)
        self.powertrain = list(powertrain)


def test_reproduce_crossover(monkeypatch):
    # Prepare two parent cars with distinct frame and powertrain values
    car1 = DummyCar(frame=[1, 1, 1], powertrain=[2, 2, 2])
    car2 = DummyCar(frame=[3, 3, 3], powertrain=[4, 4, 4])

    # Monkeypatch mutate to no-op to isolate crossover behavior
    monkeypatch.setattr("vroomon.population.population.mutate", lambda x: x)

    random.seed(42)
    child = reproduce(car1, car2)

    # Child should have same lengths
    assert len(child.frame) == len(car1.frame) == 3
    assert len(child.powertrain) == len(car1.powertrain) == 3

    # Each position should come from one of the parents
    for f in child.frame:
        assert f in (1, 3), "Frame part not inherited from parents"
    for p in child.powertrain:
        assert p in (2, 4), "Powertrain part not inherited from parents"


def test_reproduce_deep_copy(monkeypatch):
    # Ensure reproduce returns a deep copy, not modifying parents
    car1 = DummyCar(frame=[5, 5, 5], powertrain=[6, 6, 6])
    car2 = DummyCar(frame=[7, 7, 7], powertrain=[8, 8, 8])

    monkeypatch.setattr("vroomon.population.population.mutate", lambda x: x)
    random.seed(1)
    child = reproduce(car1, car2)

    # Modify child data and ensure parents are unaffected
    child.frame[0] = 999
    child.powertrain[0] = 888
    assert car1.frame != child.frame or car2.frame != child.frame
    assert car1.powertrain != child.powertrain or car2.powertrain != child.powertrain
