"""Unit tests for Car reproduction between cars of different lengths."""

import unittest
from vroomon.car.car import Car


class TestCarReproduction(unittest.TestCase):
    """Test suite for car reproduction edge cases."""

    def test_reproduce_different_lengths_short_long(self):
        """Test reproduction between a short car and a long car."""
        # Create a short car (length 2)
        short_car_dna = {
            "frame": ["R", "W"], 
            "powertrain": ["C", "D"]
        }
        short_car = Car(short_car_dna)
        
        # Create a long car (length 5)
        long_car_dna = {
            "frame": ["R", "W", "R", "R", "W"], 
            "powertrain": ["C", "D", "G", "D", "C"]
        }
        long_car = Car(long_car_dna)
        
        # This should trigger the IndexError when trying to access indices
        # that don't exist in the shorter car
        try:
            child = Car.reproduce(short_car, long_car)
            print(f"Reproduction succeeded: child has {len(child.frame)} frame parts")
        except IndexError as e:
            print(f"IndexError caught: {e}")
            self.fail(f"Reproduction failed with IndexError: {e}")
        except Exception as e:
            self.fail(f"Reproduction failed with unexpected error: {e}")

    def test_reproduce_different_lengths_long_short(self):
        """Test reproduction between a long car and a short car (reversed order)."""
        # Create a long car (length 5)
        long_car_dna = {
            "frame": ["R", "W", "R", "R", "W"], 
            "powertrain": ["C", "D", "G", "D", "C"]
        }
        long_car = Car(long_car_dna)
        
        # Create a short car (length 2)
        short_car_dna = {
            "frame": ["R", "W"], 
            "powertrain": ["C", "D"]
        }
        short_car = Car(short_car_dna)
        
        # This should also trigger the IndexError
        try:
            child = Car.reproduce(long_car, short_car)
            print(f"Reproduction succeeded: child has {len(child.frame)} frame parts")
        except IndexError as e:
            print(f"IndexError caught: {e}")
            self.fail(f"Reproduction failed with IndexError: {e}")
        except Exception as e:
            self.fail(f"Reproduction failed with unexpected error: {e}")

    def test_reproduce_extreme_length_difference(self):
        """Test reproduction with extreme length differences."""
        # Create a very short car (length 1)
        tiny_car_dna = {
            "frame": ["R"], 
            "powertrain": ["C"]
        }
        tiny_car = Car(tiny_car_dna)
        
        # Create a long car (length 7)
        long_car_dna = {
            "frame": ["R", "W", "R", "R", "W", "R", "W"], 
            "powertrain": ["C", "D", "G", "D", "C", "G", "D"]
        }
        long_car = Car(long_car_dna)
        
        # This should definitely trigger the IndexError since SEQUENCE_LENGTH = 3
        # and we're trying to access indices 0+0, 0+1, 0+2 on a car of length 1
        try:
            child = Car.reproduce(tiny_car, long_car)
            print(f"Extreme reproduction succeeded: child has {len(child.frame)} frame parts")
        except IndexError as e:
            print(f"Expected IndexError caught: {e}")
            self.fail(f"Reproduction failed with IndexError: {e}")
        except Exception as e:
            self.fail(f"Reproduction failed with unexpected error: {e}")

    def test_reproduce_same_length(self):
        """Test reproduction between cars of the same length (should work fine)."""
        # Create two cars of the same length
        car1_dna = {
            "frame": ["R", "W", "R"], 
            "powertrain": ["C", "D", "G"]
        }
        car1 = Car(car1_dna)
        
        car2_dna = {
            "frame": ["W", "R", "W"], 
            "powertrain": ["D", "C", "D"]
        }
        car2 = Car(car2_dna)
        
        # This should work without issues
        try:
            child = Car.reproduce(car1, car2)
            self.assertIsNotNone(child)
            self.assertGreater(len(child.frame), 0)
            print(f"Same length reproduction succeeded: child has {len(child.frame)} frame parts")
        except Exception as e:
            self.fail(f"Same length reproduction should not fail: {e}")

    def test_debug_reproduction_step_by_step(self):
        """Debug the reproduction process step by step."""
        # Create cars with specific lengths to trigger the issue
        mother_dna = {
            "frame": ["R", "W", "R", "R"], 
            "powertrain": ["C", "D", "G", "C"]
        }
        mother = Car(mother_dna)
        
        other_dna = {
            "frame": ["W", "R"], 
            "powertrain": ["D", "C"]
        }
        other = Car(other_dna)
        
        print(f"Mother car length: frame={len(mother.frame)}, powertrain={len(mother.powertrain)}")
        print(f"Other car length: frame={len(other.frame)}, powertrain={len(other.powertrain)}")
        print(f"SEQUENCE_LENGTH = {Car.SEQUENCE_LENGTH}")
        
        # Manually simulate what the reproduce method does
        print("\nSimulating crossover logic:")
        for idx in range(len(mother.frame)):
            print(f"Processing index {idx}:")
            
            # Check frame crossover
            for j in range(Car.SEQUENCE_LENGTH):
                target_idx = idx + j
                print(f"  Frame: trying to access idx+j = {target_idx}")
                if target_idx < len(mother.frame):
                    print(f"    Mother frame[{target_idx}] exists")
                else:
                    print(f"    Mother frame[{target_idx}] - OUT OF BOUNDS")
                    
                if target_idx < len(other.frame):
                    print(f"    Other frame[{target_idx}] exists")
                else:
                    print(f"    Other frame[{target_idx}] - OUT OF BOUNDS - THIS CAUSES IndexError!")
            
            # Check powertrain crossover  
            for j in range(Car.SEQUENCE_LENGTH):
                target_idx = idx + j
                print(f"  Powertrain: trying to access idx+j = {target_idx}")
                if target_idx < len(mother.powertrain):
                    print(f"    Mother powertrain[{target_idx}] exists")
                else:
                    print(f"    Mother powertrain[{target_idx}] - OUT OF BOUNDS")
                    
                if target_idx < len(other.powertrain):
                    print(f"    Other powertrain[{target_idx}] exists")
                else:
                    print(f"    Other powertrain[{target_idx}] - OUT OF BOUNDS - THIS CAUSES IndexError!")

    def test_reproduce_guaranteed_index_error(self):
        """Test that forces the IndexError by controlling random behavior."""
        import random
        
        # Create cars with different lengths
        short_car_dna = {
            "frame": ["R", "W"], 
            "powertrain": ["C", "D"]
        }
        short_car = Car(short_car_dna)
        
        long_car_dna = {
            "frame": ["R", "W", "R", "R", "W"], 
            "powertrain": ["C", "D", "G", "D", "C"]
        }
        long_car = Car(long_car_dna)
        
        # Set seed to ensure predictable behavior
        random.seed(42)
        
        # Force the scenario where:
        # 1. long_car becomes the mother (child)
        # 2. short_car becomes the other
        # 3. Random crossover triggers on the problematic indices
        
        print(f"Short car length: {len(short_car.frame)}")
        print(f"Long car length: {len(long_car.frame)}")
        
        # Test multiple times with different seeds to trigger the error
        for seed in range(100):
            random.seed(seed)
            try:
                child = Car.reproduce(long_car, short_car)
                print(f"Seed {seed}: Reproduction succeeded")
            except IndexError as e:
                print(f"Seed {seed}: IndexError caught: {e}")
                # This is expected - the bug exists
                self.fail(f"Found the IndexError bug with seed {seed}: {e}")
            except Exception as e:
                print(f"Seed {seed}: Unexpected error: {e}")

    def test_manual_reproduction_simulation(self):
        """Manually simulate the reproduction logic to show the bug."""
        import copy
        import random
        
        # Create test cars
        short_car_dna = {
            "frame": ["R", "W"], 
            "powertrain": ["C", "D"]
        }
        short_car = Car(short_car_dna)
        
        long_car_dna = {
            "frame": ["R", "W", "R", "R"], 
            "powertrain": ["C", "D", "G", "C"]
        }
        long_car = Car(long_car_dna)
        
        # Simulate reproduce method manually
        print("=== Manual Reproduction Simulation ===")
        print(f"Short car: frame={len(short_car.frame)}, powertrain={len(short_car.powertrain)}")
        print(f"Long car: frame={len(long_car.frame)}, powertrain={len(long_car.powertrain)}")
        
        # Force long_car as mother, short_car as other
        mother = long_car
        other = short_car
        child = copy.deepcopy(mother)
        
        print(f"Mother (long): frame={len(child.frame)}, powertrain={len(child.powertrain)}")
        print(f"Other (short): frame={len(other.frame)}, powertrain={len(other.powertrain)}")
        
        # Manually iterate through the reproduction logic
        for idx in range(len(child.frame)):
            print(f"\nProcessing idx={idx}")
            
            # Simulate frame crossover with 100% probability to force the issue
            print("  Frame crossover triggered")
            for j in range(Car.SEQUENCE_LENGTH):
                target_idx = idx + j
                print(f"    j={j}, target_idx={target_idx}")
                
                if target_idx < len(child.frame):
                    print(f"      child.frame[{target_idx}] exists")
                    
                    # This is where the bug occurs
                    if target_idx < len(other.frame):
                        print(f"      other.frame[{target_idx}] exists - would copy")
                    else:
                        print(f"      other.frame[{target_idx}] OUT OF BOUNDS - would cause IndexError!")
                        # This would be: child.frame[target_idx] = other.frame[target_idx]
                        # But other.frame[target_idx] doesn't exist!
                else:
                    print(f"      child.frame[{target_idx}] doesn't exist - skip")
            
            # Same issue with powertrain
            print("  Powertrain crossover triggered")
            for j in range(Car.SEQUENCE_LENGTH):
                target_idx = idx + j
                print(f"    j={j}, target_idx={target_idx}")
                
                if target_idx < len(child.powertrain):
                    print(f"      child.powertrain[{target_idx}] exists")
                    
                    if target_idx < len(other.powertrain):
                        print(f"      other.powertrain[{target_idx}] exists - would copy")
                    else:
                        print(f"      other.powertrain[{target_idx}] OUT OF BOUNDS - would cause IndexError!")
                else:
                    print(f"      child.powertrain[{target_idx}] doesn't exist - skip")

    def test_reproduce_index_error_bug_documentation(self):
        """Verify that the IndexError bug in reproduction has been fixed."""
        import random
        
        # Create cars with different lengths
        short_car_dna = {
            "frame": ["R", "W"], 
            "powertrain": ["C", "D"]
        }
        short_car = Car(short_car_dna)
        
        long_car_dna = {
            "frame": ["R", "W", "R", "R", "W"], 
            "powertrain": ["C", "D", "G", "D", "C"]
        }
        long_car = Car(long_car_dna)
        
        # Use seed 1 which previously triggered the bug
        random.seed(1)
        
        # This should now work without IndexError due to bounds checking in reproduce method
        try:
            child = Car.reproduce(long_car, short_car)
            self.assertIsNotNone(child)
            self.assertGreater(len(child.frame), 0)
            self.assertEqual(len(child.frame), len(child.powertrain))
            print(f"Reproduction succeeded: child has {len(child.frame)} frame parts")
            print("✅ IndexError bug has been fixed!")
        except IndexError as e:
            self.fail(f"IndexError should not occur - bug should be fixed: {e}")
        except Exception as e:
            self.fail(f"Unexpected error during reproduction: {e}")

    def test_reproduce_after_fix_should_work(self):
        """Test that will pass once the reproduce method is fixed."""
        import random
        
        # Create cars with different lengths
        short_car_dna = {
            "frame": ["R", "W"], 
            "powertrain": ["C", "D"]
        }
        short_car = Car(short_car_dna)
        
        long_car_dna = {
            "frame": ["R", "W", "R", "R", "W"], 
            "powertrain": ["C", "D", "G", "D", "C"]
        }
        long_car = Car(long_car_dna)
        
        # Test multiple seeds to ensure robustness
        for seed in range(10):
            random.seed(seed)
            try:
                child = Car.reproduce(long_car, short_car)
                self.assertIsNotNone(child)
                self.assertGreater(len(child.frame), 0)
                self.assertGreater(len(child.powertrain), 0)
                # Child length can vary due to mutation, but should be reasonable
                self.assertLessEqual(len(child.frame), 20)  # Reasonable upper bound
                self.assertEqual(len(child.frame), len(child.powertrain))  # Should always match
            except IndexError as e:
                # This should not happen after the fix
                self.fail(f"IndexError should not occur after fix (seed {seed}): {e}")
            except Exception as e:
                self.fail(f"Unexpected error during reproduction (seed {seed}): {e}")


if __name__ == "__main__":
    unittest.main(verbosity=2)