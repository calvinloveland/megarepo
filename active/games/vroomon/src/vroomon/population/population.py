"""Population utilities for car evolution and scoring."""

import copy
import importlib
import random
from functools import lru_cache


SEQUENCE_LENGTH = 3


def _load_module(*candidates):
    """Import the first available module name from a candidate list."""
    last_error = None
    for module_name in candidates:
        try:
            return importlib.import_module(module_name)
        except ModuleNotFoundError as error:
            last_error = error
    raise last_error


@lru_cache(maxsize=1)
def _runtime_dependencies():
    """Resolve runtime classes/lists in both package and repo execution modes."""
    car_module = _load_module("vroomon.car.car", "src.vroomon.car.car")
    frame_module = _load_module("vroomon.car.frame.all", "src.vroomon.car.frame.all")
    powertrain_module = _load_module(
        "vroomon.car.powertrain.all", "src.vroomon.car.powertrain.all"
    )
    ground_module = _load_module("vroomon.ground", "src.vroomon.ground")
    simulation_module = _load_module("vroomon.simulation", "src.vroomon.simulation")
    return (
        car_module.Car,
        frame_module.ALL_FRAME_PARTS,
        powertrain_module.ALL_POWERTRAIN_PARTS,
        ground_module.Ground,
        simulation_module.Simulation,
    )


def mutate(car):
    """Mutate a car-like object in place, returning the same object."""
    car_class, frame_parts, powertrain_parts, _, _ = _runtime_dependencies()
    # Use Car.mutate for Car instances
    if isinstance(car, car_class):
        return car.mutate()

    i = 0
    replace_p = 0.10
    remove_p = 0.05
    insert_p = 0.05
    # work on non-Car objects in place
    while i < len(car.frame):
        r = random.random()
        if r < replace_p:
            car.frame[i] = random.choice(frame_parts).from_random()
            car.powertrain[i] = random.choice(powertrain_parts).from_random()
            i += 1
        elif r < replace_p + remove_p and len(car.frame) > 1:
            car.frame.pop(i)
            car.powertrain.pop(i)
        elif r < replace_p + remove_p + insert_p:
            car.frame.insert(i, random.choice(frame_parts).from_random())
            car.powertrain.insert(i, random.choice(powertrain_parts).from_random())
            i += 1
        else:
            i += 1
    assert len(car.frame) == len(car.powertrain), (
        "Frame and powertrain lists are mismatched: "
        f"{len(car.frame)} vs {len(car.powertrain)}"
    )
    return car


def reproduce(car1, car2):
    """Reproduce two car-like objects and return a mutated child."""
    car_class, _, _, _, _ = _runtime_dependencies()
    # Use Car.reproduce for Car instances
    if isinstance(car1, car_class) and isinstance(car2, car_class):
        return car_class.reproduce(car1, car2)

    # Fallback for non-Car objects
    mother_car = random.choice([car1, car2])
    other_car = car1 if mother_car == car2 else car2
    car3 = copy.deepcopy(mother_car)
    for i in range(len(car3.frame)):
        if random.random() < 0.5:
            _copy_sequence_segment(car3.frame, other_car.frame, i)
        if random.random() < 0.5:
            _copy_sequence_segment(car3.powertrain, other_car.powertrain, i)
    return mutate(car3)


def _copy_sequence_segment(destination, source, start):
    """Copy a bounded sequence segment from source to destination."""
    for offset in range(SEQUENCE_LENGTH):
        position = start + offset
        if position >= len(destination) or position >= len(source):
            break
        destination[position] = source[position]


def random_dna(length):
    """Generate random DNA of given length for frame and powertrain."""
    frame_codes = ["R", "W"]
    powertrain_codes = ["C", "D", "G"]
    return {
        "frame": [random.choice(frame_codes) for _ in range(length)],
        "powertrain": [random.choice(powertrain_codes) for _ in range(length)],
    }


def initialize_population(size, dna_length):
    """Create an initial population of cars with random DNA."""
    car_class, _, _, _, _ = _runtime_dependencies()
    return [car_class(random_dna(dna_length)) for _ in range(size)]


def score_population(population, ground=None, simulation=None):
    """Score each car in the population and return list of (car, score) tuples."""
    _, _, _, ground_class, simulation_class = _runtime_dependencies()
    if ground is None:
        ground = ground_class()
    if simulation is None:
        simulation = simulation_class()
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
