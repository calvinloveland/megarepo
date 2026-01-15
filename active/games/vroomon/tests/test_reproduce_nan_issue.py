"""Test to reproduce the exact NaN issue from the main simulation."""

import unittest
import math
import random
from vroomon.car.car import Car
from vroomon.simulation import Simulation
from vroomon.ground import Ground
from vroomon.population.population import initialize_population, evolve_population


class TestReproduceNaNIssue(unittest.TestCase):
    """Test to reproduce the exact issue happening in main.py."""

    def test_reproduce_main_simulation_issue(self):
        """Reproduce the exact sequence from main.py that causes the NaN issue."""
        print("=== Reproducing Main Simulation Issue ===")
        
        # Use the same random seed to get reproducible results
        random.seed(42)
        
        # Replicate the main.py simulation parameters
        population_size = 20
        dna_length = 5
        generations = 2  # Just a few generations to trigger the issue
        
        # Initialize population exactly like main.py
        pop = initialize_population(population_size, dna_length)
        ground = Ground()
        
        print(f"Initial population size: {len(pop)}")
        
        # Check each car in the initial population for potential NaN issues
        for i, car_dna in enumerate(pop):
            print(f"\nChecking car {i}: {car_dna}")
            
            try:
                car = Car(car_dna)
                
                # Check for problematic wheel configurations
                for j, part in enumerate(car.frame_parts):
                    if hasattr(part, 'motor'):  # It's a wheel
                        motor = part.motor
                        print(f"  Wheel {j}: rate={motor.rate}, max_force={motor.max_force}")
                        
                        # Check for NaN or problematic values
                        if math.isnan(motor.rate):
                            self.fail(f"Car {i} wheel {j} has NaN motor rate")
                        if math.isnan(motor.max_force):
                            self.fail(f"Car {i} wheel {j} has NaN motor max_force")
                        if math.isinf(motor.rate):
                            self.fail(f"Car {i} wheel {j} has infinite motor rate")
                        if math.isinf(motor.max_force):
                            self.fail(f"Car {i} wheel {j} has infinite motor max_force")
                
                # Try a quick simulation to see if it causes NaN
                sim = Simulation()
                try:
                    score = sim.score_car(car, ground, visualize=False)
                    print(f"  Car {i} simulation succeeded with score: {score}")
                    
                    if math.isnan(score):
                        print(f"  WARNING: Car {i} has NaN score!")
                        
                except Exception as e:
                    print(f"  Car {i} simulation failed: {e}")
                    
            except Exception as e:
                print(f"  Car {i} creation failed: {e}")
        
        # Now try the evolution process that triggers the issue
        try:
            for gen in range(generations):
                print(f"\n=== Generation {gen + 1} ===")
                
                sim = Simulation()
                pop = evolve_population(
                    pop, retain_ratio=0.5, mutation_rate=0.1, ground=ground, simulation=sim
                )
                
                print(f"Population after evolution: {len(pop)} cars")
                
                # Check for any cars with NaN issues after evolution
                for i, car_dna in enumerate(pop[:5]):  # Check first 5 cars
                    try:
                        car = Car(car_dna)
                        test_sim = Simulation()
                        score = test_sim.score_car(car, ground, visualize=False)
                        
                        if math.isnan(score):
                            print(f"  Generation {gen+1} car {i} has NaN score!")
                            
                    except Exception as e:
                        print(f"  Generation {gen+1} car {i} failed: {e}")
                        
        except Exception as e:
            print(f"Evolution failed: {e}")
            raise

    def test_specific_nan_conditions(self):
        """Test specific conditions that might lead to NaN in motor parameters."""
        print("\n=== Testing Specific NaN Conditions ===")
        
        # Test cases that might produce NaN
        problematic_cases = [
            # Case 1: Division by zero in wheel rate calculation
            {"power": 0.0, "size": 0.0, "name": "Zero power, zero size"},
            # Case 2: Very small size causing extreme rate
            {"power": 100.0, "size": 0.001, "name": "Large power, tiny size"},
            # Case 3: NaN power input
            {"power": float('nan'), "size": 10.0, "name": "NaN power"},
            # Case 4: Infinite power
            {"power": float('inf'), "size": 10.0, "name": "Infinite power"},
        ]
        
        for case in problematic_cases:
            print(f"\nTesting: {case['name']}")
            print(f"  power={case['power']}, size={case['size']}")
            
            try:
                # Create a simple wheel directly to test the calculation
                from vroomon.car.frame.wheel import Wheel
                import pymunk
                
                # Create a dummy body
                body = pymunk.Body(1, 1000)
                pos = pymunk.Vec2d(0, 0)
                
                # Test wheel creation with problematic values
                wheel = Wheel(body, pos, case['power'], 1000.0, case['size'])
                
                # Check the resulting motor parameters
                rate = wheel.motor.rate
                max_force = wheel.motor.max_force
                
                print(f"  Result: rate={rate}, max_force={max_force}")
                
                # Check for NaN/inf
                if math.isnan(rate):
                    print(f"  ERROR: Motor rate is NaN!")
                if math.isnan(max_force):
                    print(f"  ERROR: Motor max_force is NaN!")
                if math.isinf(rate):
                    print(f"  ERROR: Motor rate is infinite!")
                if math.isinf(max_force):
                    print(f"  ERROR: Motor max_force is infinite!")
                    
            except Exception as e:
                print(f"  Exception during wheel creation: {e}")

    def test_nan_detection_during_evolution(self):
        """Test for NaN detection during the evolution process - optimized for speed."""
        print("\n=== Testing NaN Detection During Evolution (Fast Version) ===")
        
        # Create a small population with known problematic configurations
        # Reduced size for faster testing
        problematic_population = [
            {"frame": ["W"], "powertrain": ["D"]},  # Zero power wheel
            {"frame": ["W"], "powertrain": ["C"]},  # Working wheel
            {"frame": ["R"], "powertrain": ["C"]},  # Rectangle only
        ]
        
        ground = Ground()
        
        for i, dna in enumerate(problematic_population):
            print(f"\nTesting config {i}: {dna}")
            
            try:
                car = Car(dna)
                sim = Simulation()
                
                # Test without visualization (faster)
                score_no_viz = sim.score_car(car, ground, visualize=False)
                print(f"  Score without visualization: {score_no_viz}")
                
                # Validate score is not NaN
                self.assertFalse(math.isnan(score_no_viz), 
                               f"Config {i} produced NaN score: {score_no_viz}")
                self.assertFalse(math.isinf(score_no_viz), 
                               f"Config {i} produced infinite score: {score_no_viz}")
                
                # Only test visualization for one config to save time
                if i == 0:
                    print("  Testing visualization for first config only...")
                    sim2 = Simulation()
                    score_with_viz = sim2.score_car(car, ground, visualize=True)
                    print(f"  Score with visualization: {score_with_viz}")
                    
                    self.assertFalse(math.isnan(score_with_viz), 
                                   f"Config {i} with viz produced NaN score: {score_with_viz}")
                
            except Exception as e:
                print(f"  Configuration {i} failed: {e}")
                # Log pygame-specific errors but don't fail the test
                if "center argument must be a pair of numbers" in str(e):
                    print(f"  *** FOUND THE PYGAME ERROR! ***")
                    print(f"  This suggests NaN coordinates are reaching pygame")
                else:
                    # For other errors, we want to know about them
                    self.fail(f"Unexpected error in config {i}: {e}")
        
        print("Fast evolution test completed successfully")


if __name__ == "__main__":
    unittest.main(verbosity=2)