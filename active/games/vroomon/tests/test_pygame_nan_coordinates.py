"""Unit tests to hunt down the pygame TypeError: center argument must be a pair of numbers."""

import unittest
import math
import pygame
import pymunk
import pymunk.pygame_util
from vroomon.car.car import Car
from vroomon.simulation import Simulation
from vroomon.ground import Ground


class TestPygameNaNCoordinates(unittest.TestCase):
    """Test suite to identify and isolate the pygame coordinate NaN bug."""

    def setUp(self):
        """Set up test environment with pygame and pymunk."""
        pygame.init()
        self.screen = pygame.Surface((800, 600))
        
    def tearDown(self):
        """Clean up pygame."""
        pygame.quit()

    def test_coordinate_validation_during_simulation(self):
        """Test that all physics body coordinates remain valid numbers during simulation."""
        print("=== Testing Coordinate Validation During Simulation ===")
        
        # Test various car configurations that might cause NaN
        test_cars = [
            {"frame": ["W"], "powertrain": ["D"]},  # Zero power wheel
            {"frame": ["W"], "powertrain": ["G"]},  # Zero power wheel
            {"frame": ["W"], "powertrain": ["C"]},  # Working wheel
            {"frame": ["R"], "powertrain": ["C"]},  # Rectangle only
            {"frame": ["W", "R"], "powertrain": ["D", "C"]},  # Mixed
        ]
        
        for i, dna in enumerate(test_cars):
            print(f"\nTesting car {i}: {dna}")
            
            with self.subTest(car_config=i, dna=dna):
                car = Car(dna)
                simulation = Simulation()
                ground = Ground()
                
                # Check initial coordinates
                self._validate_car_coordinates(car, f"Car {i} initial state")
                
                try:
                    # Run a short simulation step by step
                    space = pymunk.Space()
                    space.gravity = (0, -981)  # Earth gravity
                    
                    # Add ground
                    ground_body = pymunk.Body(body_type=pymunk.Body.STATIC)
                    ground_shape = pymunk.Segment(ground_body, (0, 0), (1000, 0), 5)
                    ground_shape.friction = 0.7
                    space.add(ground_body, ground_shape)
                    
                    # Add car to space
                    for body, shape in car.frame:
                        space.add(body, shape)
                    
                    # Step through simulation and check coordinates
                    for step in range(100):  # 100 steps should be enough to trigger NaN
                        space.step(1/60.0)  # 60 FPS
                        
                        # Check coordinates after each step
                        for j, (body, shape) in enumerate(car.frame):
                            pos = body.position
                            vel = body.velocity
                            
                            if math.isnan(pos.x) or math.isnan(pos.y):
                                self.fail(f"Car {i} frame {j} position became NaN at step {step}: {pos}")
                            
                            if math.isnan(vel.x) or math.isnan(vel.y):
                                self.fail(f"Car {i} frame {j} velocity became NaN at step {step}: {vel}")
                            
                            if math.isinf(pos.x) or math.isinf(pos.y):
                                self.fail(f"Car {i} frame {j} position became infinite at step {step}: {pos}")
                            
                            if math.isinf(vel.x) or math.isinf(vel.y):
                                self.fail(f"Car {i} frame {j} velocity became infinite at step {step}: {vel}")
                    
                    print(f"Car {i} completed 100 simulation steps without NaN coordinates")
                    
                except Exception as e:
                    print(f"Car {i} failed during simulation: {e}")
                    # Still validate final coordinates
                    self._validate_car_coordinates(car, f"Car {i} after failure", allow_failure=True)
                    raise

    def test_wheel_motor_forces_for_nan(self):
        """Test that wheel motor forces don't become NaN."""
        print("\n=== Testing Wheel Motor Forces for NaN ===")
        
        problematic_cars = [
            {"frame": ["W"], "powertrain": ["D"]},  # DriveShaft only
            {"frame": ["W"], "powertrain": ["G"]},  # GearSet only
        ]
        
        for i, dna in enumerate(problematic_cars):
            print(f"\nTesting motor forces for car {i}: {dna}")
            
            car = Car(dna)
            
            # Check wheel motor configuration
            for j, part in enumerate(car.frame_parts):
                if hasattr(part, 'motor'):  # It's a wheel
                    motor = part.motor
                    print(f"  Wheel {j} motor:")
                    print(f"    rate: {motor.rate}")
                    print(f"    max_force: {motor.max_force}")
                    
                    # These should never be NaN
                    self.assertFalse(math.isnan(motor.rate), 
                                   f"Car {i} wheel {j} motor rate is NaN")
                    self.assertFalse(math.isnan(motor.max_force), 
                                   f"Car {i} wheel {j} motor max_force is NaN")
                    self.assertFalse(math.isinf(motor.rate), 
                                   f"Car {i} wheel {j} motor rate is infinite")
                    self.assertFalse(math.isinf(motor.max_force), 
                                   f"Car {i} wheel {j} motor max_force is infinite")
                    
                    # Check for problematic combinations
                    if motor.rate == 0 and motor.max_force > 0:
                        print(f"    WARNING: Zero rate with non-zero force detected!")
                        print(f"    This combination may cause physics instability")

    def test_pygame_drawing_with_known_nan_values(self):
        """Test pygame drawing functions with known NaN values to reproduce the error."""
        print("\n=== Testing Pygame Drawing with NaN Values ===")
        
        surface = pygame.Surface((100, 100))
        
        # Test what happens when we try to draw with NaN coordinates
        nan_value = float('nan')
        inf_value = float('inf')
        
        test_cases = [
            ("NaN center", (nan_value, 50)),
            ("NaN radius", (50, 50), nan_value),
            ("Inf center", (inf_value, 50)),
            ("Both NaN", (nan_value, nan_value)),
        ]
        
        for case_name, *args in test_cases:
            print(f"Testing {case_name}")
            
            # Try the drawing operation and see what actually happens
            try:
                if len(args) == 1:  # center only
                    result = pygame.draw.circle(surface, (255, 0, 0), args[0], 10)
                else:  # center and radius
                    result = pygame.draw.circle(surface, (255, 0, 0), args[0], args[1] if len(args) > 1 else 10)
                
                print(f"  {case_name}: Drawing succeeded (unexpected), result: {result}")
                # If drawing with NaN succeeds, that's actually fine - it means pygame handles it
                
            except (TypeError, ValueError, OverflowError) as e:
                print(f"  {case_name}: Drawing failed as expected: {e}")
                # This is what we might expect
                
            except Exception as e:
                print(f"  {case_name}: Drawing failed with unexpected error: {e}")
                self.fail(f"Unexpected error type for {case_name}: {e}")
        
        print("Pygame NaN coordinate test completed - pygame may handle NaN differently than expected")

    def test_pymunk_debug_drawing_isolation(self):
        """Test PyMunk debug drawing in isolation to identify the exact failure point."""
        print("\n=== Testing PyMunk Debug Drawing Isolation ===")
        
        pygame.init()
        screen = pygame.Surface((800, 600))
        
        # Create a space with a problematic car
        space = pymunk.Space()
        space.gravity = (0, -981)
        
        # Test with a zero-power wheel car
        car = Car({"frame": ["W"], "powertrain": ["D"]})
        
        # Add car to space
        for body, shape in car.frame:
            space.add(body, shape)
        
        # Create debug draw options
        draw_options = pymunk.pygame_util.DrawOptions(screen)
        
        # Step simulation and try to draw
        for step in range(10):
            space.step(1/60.0)
            
            # Check if any bodies have NaN coordinates before drawing
            for body in space.bodies:
                pos = body.position
                vel = body.velocity
                
                print(f"Step {step}, Body position: {pos}, velocity: {vel}")
                
                if math.isnan(pos.x) or math.isnan(pos.y):
                    print(f"NaN detected in position at step {step}: {pos}")
                    
                    # Try to draw anyway to reproduce the error
                    try:
                        space.debug_draw(draw_options)
                        self.fail("Expected TypeError but drawing succeeded with NaN coordinates")
                    except TypeError as e:
                        print(f"Successfully reproduced TypeError: {e}")
                        return  # We found the issue!
                
        print("No NaN coordinates detected in first 10 steps")

    def _validate_car_coordinates(self, car, context, allow_failure=False):
        """Helper method to validate all coordinates in a car are valid numbers."""
        for i, (body, shape) in enumerate(car.frame):
            pos = body.position
            vel = body.velocity
            
            try:
                self.assertFalse(math.isnan(pos.x), f"{context} - frame {i} position.x is NaN: {pos}")
                self.assertFalse(math.isnan(pos.y), f"{context} - frame {i} position.y is NaN: {pos}")
                self.assertFalse(math.isnan(vel.x), f"{context} - frame {i} velocity.x is NaN: {vel}")
                self.assertFalse(math.isnan(vel.y), f"{context} - frame {i} velocity.y is NaN: {vel}")
                self.assertFalse(math.isinf(pos.x), f"{context} - frame {i} position.x is infinite: {pos}")
                self.assertFalse(math.isinf(pos.y), f"{context} - frame {i} position.y is infinite: {pos}")
                self.assertFalse(math.isinf(vel.x), f"{context} - frame {i} velocity.x is infinite: {vel}")
                self.assertFalse(math.isinf(vel.y), f"{context} - frame {i} velocity.y is infinite: {vel}")
            except AssertionError:
                if not allow_failure:
                    raise
                print(f"Validation failed for {context} - frame {i}: pos={pos}, vel={vel}")


if __name__ == "__main__":
    unittest.main(verbosity=2)