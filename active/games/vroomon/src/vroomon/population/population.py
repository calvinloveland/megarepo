import copy
import random

from vroomon.car.car import Car  # added import for Car type checking
from vroomon.car.frame.all import ALL_FRAME_PARTS
from vroomon.car.powertrain.all import ALL_POWERTRAIN_PARTS

SEQUENCE_LENGTH = 3


def mutate(car):
    # Use Car.mutate for Car instances
    if isinstance(car, Car):
        return car.mutate()

    i = 0
    replace_p = 0.10
    remove_p = 0.05
    insert_p = 0.05
    # work on non-Car objects in place
    while i < len(car.frame):
        r = random.random()
        if r < replace_p:
            car.frame[i] = random.choice(ALL_FRAME_PARTS).from_random()
            car.powertrain[i] = random.choice(ALL_POWERTRAIN_PARTS).from_random()
            i += 1
        elif r < replace_p + remove_p and len(car.frame) > 1:
            car.frame.pop(i)
            car.powertrain.pop(i)
        elif r < replace_p + remove_p + insert_p:
            car.frame.insert(i, random.choice(ALL_FRAME_PARTS).from_random())
            car.powertrain.insert(i, random.choice(ALL_POWERTRAIN_PARTS).from_random())
            i += 1
        else:
            i += 1
    assert len(car.frame) == len(
        car.powertrain
    ), f"Frame and powertrain lists are mismatched: {len(car.frame)} vs {len(car.powertrain)}"
    return car


def reproduce(car1, car2):
    # Use Car.reproduce for Car instances
    if isinstance(car1, Car) and isinstance(car2, Car):
        return Car.reproduce(car1, car2)

    # Fallback for non-Car objects
    mother_car = random.choice([car1, car2])
    other_car = car1 if mother_car == car2 else car2
    car3 = copy.deepcopy(mother_car)
    for i in range(len(car3.frame)):
        if random.random() < 0.5:
            for j in range(SEQUENCE_LENGTH):
                if i + j < len(car3.frame):
                    car3.frame[i + j] = other_car.frame[i + j]
        if random.random() < 0.5:
            for j in range(SEQUENCE_LENGTH):
                if i + j < len(car3.powertrain):
                    car3.powertrain[i + j] = other_car.powertrain[i + j]
    # Mutate child object if available
    try:
        return mutate(car3)
    except AttributeError:
        return car3


def random_dna(length):
    """Generate random DNA of given length for frame and powertrain."""
    FRAME_CODES = ["R", "W"]
    POWERTRAIN_CODES = ["C", "D", "G"]
    return {
        "frame": [random.choice(FRAME_CODES) for _ in range(length)],
        "powertrain": [random.choice(POWERTRAIN_CODES) for _ in range(length)],
    }


from vroomon.ground import Ground
from vroomon.simulation import Simulation


def initialize_population(size, dna_length):
    """Create an initial population of cars with random DNA."""
    return [Car(random_dna(dna_length)) for _ in range(size)]


def score_population(population, ground=None, simulation=None):
    """Score each car in the population and return list of (car, score) tuples."""
    if ground is None:
        ground = Ground()
    if simulation is None:
        simulation = Simulation()
    # Batch simulate and score all cars at once
    return simulation.score_population(population, ground)


def evolve_population(
    population, retain_ratio=0.5, mutation_rate=0.1, ground=None, simulation=None
):
    """Evolve the population by selecting top performers, reproducing and mutating."""
    scored = score_population(population, ground, simulation)
    # sort by descending score
    scored.sort(key=lambda x: x[1], reverse=True)
    retain_count = max(2, int(len(scored) * retain_ratio))
    # keep top performers
    survivors = [car for car, _ in scored[:retain_count]]
    # fill the rest by breeding
    children = []
    while len(survivors) + len(children) < len(population):
        parent1, parent2 = random.sample(survivors, 2)
        child = reproduce(parent1, parent2)
        if random.random() < mutation_rate:
            mutate(child)
        children.append(child)
    # new population
    return survivors + children
