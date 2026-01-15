"""vroomon.main module."""

from loguru import logger

from vroomon.car.car import Car
from vroomon.ground import Ground
from vroomon.population.population import (
    evolve_population,
    initialize_population,
    score_population,
)
from vroomon.simulation import Simulation

CAR_DNA = {
    "powertrain": ["C", "G", "D", "D", "G"],  # C = Cylinder, G = Gear, D = DriveShaft
    "frame": ["R", "W", "R", "R", "W"],  # R = Rectangle, W = Wheel
}


def test_car():
    """Test that a basic Car has a positive score on default ground."""
    car = Car(CAR_DNA)
    ground = Ground()
    simulation = Simulation()
    score = simulation.score_car(car=car, ground=ground, visualize=True)
    assert score > 0, "Car should have a positive score on the ground"


def main(visualize_generations=False):
    """Run the evolutionary simulation and display best car results."""
    # Evolutionary run: maintain a population, score and reproduce
    population_size = 20
    dna_length = 5
    generations = 10
    # initialize population
    pop = initialize_population(population_size, dna_length)
    ground = Ground()
    # evolve over generations
    for gen in range(generations):
        # Create fresh simulation for each generation to avoid state conflicts
        sim = Simulation()
        pop = evolve_population(
            pop, retain_ratio=0.5, mutation_rate=0.1, ground=ground, simulation=sim
        )
        scored = score_population(pop, ground, sim)
        best_car, best_score = max(scored, key=lambda x: x[1])
        logger.info(f"Generation {gen+1}/{generations}, Best score: {best_score}")

        # Visualize the best car from this generation if requested
        if visualize_generations:
            logger.info(f"Visualizing best car from generation {gen+1}")
            gen_sim = Simulation()  # Fresh simulation for generation visualization
            gen_score = gen_sim.score_car(best_car, ground, visualize=True)
            logger.info(f"Generation {gen+1} best car score: {gen_score}")

    # run simulation with visualization for the final best car
    logger.info(f"Best car DNA: {best_car}")
    final_sim = Simulation()  # Fresh simulation for final visualization
    final_score = final_sim.score_car(best_car, ground, visualize=True)
    logger.info(f"Final best score: {final_score}")


# Example: how to enable generation visualization
if __name__ == "__main__":
    # Set this to True to watch each generation evolve
    visualize_each_generation = True  # Changed from False to True
    main(visualize_generations=visualize_each_generation)
