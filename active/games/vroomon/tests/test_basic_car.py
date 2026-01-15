from vroomon.car import Car
from vroomon.ground import Ground
from vroomon.simulation import Simulation

CAR_DNA = {
    "frame": ["R", "W", "R", "R", "W"],  # R = Rectangle, W = Wheel
    "powertrain": ["C", "G", "D", "D", "G"],  # C = Cylinder, G = Gear, D = DriveShaft
}


def test_car():
    car = Car(CAR_DNA)
    ground = Ground()
    simulation = Simulation()
    score = simulation.score_car(car, ground)
    assert score > 0, "Car should have a positive score on the ground"


def test_car_with_visualization():
    car = Car(CAR_DNA)
    ground = Ground()
    simulation = Simulation()
    score = simulation.score_car(car, ground, visualize=True)
    assert score > 0, "Car should have a positive score on the ground with visualization"


def test_car_with_empty_dna():
    empty_dna = {"frame": [], "powertrain": []}
    try:
        car = Car(empty_dna)
        assert False, "Car with empty DNA should raise a ValueError"
    except ValueError as e:
        assert "Frame must have at least one part" in str(e)
        # This is the expected behavior


def test_simulation_with_high_gravity():
    car = Car(CAR_DNA)
    ground = Ground()
    simulation = Simulation()
    simulation.space.gravity = (0, 100)  # Extreme gravity
    score = simulation.score_car(car, ground)
    assert score > 0, "Car should still have a positive score under high gravity"

if __name__ == "__main__":
    test_car_with_visualization()