"""Unit test to track down NaN coordinate issues causing pygame drawing errors."""

import unittest
import math
import pygame
import pymunk
import pymunk.pygame_util
from vroomon.car.car import Car
from vroomon.simulation import Simulation
from vroomon.ground import Ground


class TestCoordinateNaNTracking(unittest.TestCase):
    """Test suite to systematically track down NaN coordinate issues."""

    def setUp(self):
        """Set up test environment."""
        pygame.init()
        self.screen = pygame.Surface((800, 600))
        
    def tearDown(self):
        """Clean up pygame."""
        pygame.quit()

    def test_coordinate_progression_tracking(self):
        """Track coordinate progression step by step to identify when NaN occurs."""
        print("=== Coordinate Progression Tracking ===")
        
        # Test the exact problematic configurations from your error
        problematic_configs = [
            {"frame": ["W"], "powertrain": ["D"]},  # Zero power wheel - most likely culprit
            {"frame": ["W"], "powertrain": ["G"]},  # GearSet only
            {"frame": ["W", "R"], "powertrain": ["D", "C"]},  # Mixed config
        ]
        
        for config_idx, dna in enumerate(problematic_configs):
            print(f"\n--- Testing Config {config_idx}: {dna} ---")
            
            with self.subTest(config=config_idx):
                car = Car(dna)
                ground = Ground()
                
                # Create simulation environment exactly like main.py
                simulation = Simulation()
                
                # Reset car physics (this is where issues often start)
                car.reset_physics()
                
                # Check coordinates after reset
                self._check_all_coordinates(car, f"Config {config_idx} after reset")
                
                # Add ground to space
                ground.add_to_space(simulation.space)
                
                # Add car to space (another potential NaN source)
                car.add_to_space(simulation.space)
                
                # Check coordinates after adding to space
                self._check_all_coordinates(car, f"Config {config_idx} after adding to space")
                
                # Step through simulation and monitor coordinates
                pygame.init()
                screen = pygame.Surface((600, 600))
                draw_options = pymunk.pygame_util.DrawOptions(screen)
                
                nan_step = None
                for step in range(100):  # Reduced steps for faster testing
                    # Step physics
                    for _ in range(10):
                        simulation.space.step(0.01)
                    
                    # Check for NaN after each physics step
                    if self._has_nan_coordinates(car):
                        nan_step = step
                        print(f"  NaN detected at step {step}")
                        break
                    
                    # Try drawing to see if it fails
                    try:
                        screen.fill((255, 255, 255))
                        simulation.space.debug_draw(draw_options)
                    except TypeError as e:
                        if "center argument must be a pair of numbers" in str(e):
                            print(f"  Pygame drawing error at step {step}: {e}")
                            self._detailed_coordinate_dump(car, simulation.space, step)
                            self.fail(f"Config {config_idx} caused pygame drawing error at step {step}")
                        else:
                            raise e
                    
                    # Check every 10 steps for performance
                    if step % 10 == 0:
                        self._check_all_coordinates(car, f"Config {config_idx} step {step}", fail_on_nan=False)
                
                if nan_step is not None:
                    self._detailed_coordinate_dump(car, simulation.space, nan_step)
                    self.fail(f"Config {config_idx} developed NaN coordinates at step {nan_step}")
                
                print(f"  Config {config_idx} completed 100 steps without NaN")

    def test_motor_configuration_validation(self):
        """Validate motor configurations that might cause coordinate instability."""
        print("\n=== Motor Configuration Validation ===")
        
        # Test problematic motor setups directly
        test_configs = [
            {"power": 0.0, "torque": 1000.0, "size": 10.0, "name": "Zero power, high torque"},
            {"power": 0.0, "torque": 0.0, "size": 10.0, "name": "Zero power, zero torque"},
            {"power": 100.0, "torque": 0.0, "size": 10.0, "name": "High power, zero torque"},
            {"power": float('nan'), "torque": 1000.0, "size": 10.0, "name": "NaN power"},
            {"power": 100.0, "torque": float('nan'), "size": 10.0, "name": "NaN torque"},
        ]
        
        for config in test_configs:
            print(f"\nTesting motor config: {config['name']}")
            
            with self.subTest(motor_config=config['name']):
                space = pymunk.Space()
                space.gravity = (0, -981)
                
                # Create wheel with test configuration
                try:
                    from vroomon.car.frame.wheel import Wheel
                    body = pymunk.Body(1, 100)
                    body.position = (50, 100)
                    pos = type('Position', (), {'x': 0, 'y': 0})()
                    
                    wheel = Wheel(body, pos, config['power'], config['torque'], config['size'])
                    
                    # Add to space
                    space.add(wheel.wheel_body, wheel.circle, wheel.pivot, wheel.motor)
                    
                    # Create ground
                    ground_body = space.static_body
                    ground_shape = pymunk.Segment(ground_body, (0, 50), (200, 50), 5)
                    space.add(ground_shape)
                    
                    # Step simulation and monitor
                    for step in range(50):
                        space.step(1/60.0)
                        
                        pos = wheel.wheel_body.position
                        vel = wheel.wheel_body.velocity
                        
                        if math.isnan(pos.x) or math.isnan(pos.y):
                            print(f"    NaN position at step {step}: {pos}")
                            print(f"    Motor rate: {wheel.motor.rate}")
                            print(f"    Motor max_force: {wheel.motor.max_force}")
                            self.fail(f"Motor config '{config['name']}' caused NaN position")
                        
                        if math.isnan(vel.x) or math.isnan(vel.y):
                            print(f"    NaN velocity at step {step}: {vel}")
                            print(f"    Motor rate: {wheel.motor.rate}")
                            print(f"    Motor max_force: {wheel.motor.max_force}")
                            self.fail(f"Motor config '{config['name']}' caused NaN velocity")
                    
                    print(f"    Motor config '{config['name']}' survived 50 steps")
                    
                except Exception as e:
                    if 'nan' not in config['name'].lower():
                        print(f"    Unexpected failure for '{config['name']}': {e}")
                        self.fail(f"Motor config '{config['name']}' failed unexpectedly: {e}")
                    else:
                        print(f"    Expected failure for '{config['name']}': {e}")

    def test_visualization_error_reproduction(self):
        """Reproduce the exact visualization error from the terminal output."""
        print("\n=== Visualization Error Reproduction ===")
        
        # Create the exact scenario that causes the pygame error
        car = Car({"frame": ["W"], "powertrain": ["D"]})  # Zero power wheel
        simulation = Simulation()
        ground = Ground()
        
        # Set up visualization exactly like main.py
        pygame.init()
        screen = pygame.display.set_mode((600, 600))
        clock = pygame.time.Clock()
        draw_options = pymunk.pygame_util.DrawOptions(screen)
        
        # Reset and add to space
        car.reset_physics()
        car.add_to_space(simulation.space)
        ground.add_to_space(simulation.space)
        
        # Monitor for the exact error pattern
        error_caught = False
        error_step = None
        
        try:
            for step in range(200):  # More steps to trigger the error
                # Step physics multiple times like in main.py
                for _ in range(10):
                    simulation.space.step(0.01)
                
                # Try the drawing that fails
                screen.fill((255, 255, 255))
                
                # This is where the error occurs
                try:
                    simulation.space.debug_draw(draw_options)
                    pygame.display.flip()
                    clock.tick(60)
                except TypeError as e:
                    if "center argument must be a pair of numbers" in str(e):
                        print(f"    CAUGHT THE ERROR at step {step}!")
                        print(f"    Error: {e}")
                        error_caught = True
                        error_step = step
                        
                        # Dump all coordinates to see what's NaN
                        self._detailed_coordinate_dump(car, simulation.space, step)
                        break
                    else:
                        raise e
                
                # Also check for NaN manually
                if self._has_nan_coordinates(car):
                    print(f"    Manual NaN detection at step {step}")
                    break
        
        except Exception as e:
            print(f"    Unexpected error: {e}")
            raise
        finally:
            pygame.quit()
        
        if error_caught:
            self.fail(f"Successfully reproduced the pygame drawing error at step {error_step}")
        else:
            print("    Could not reproduce the pygame drawing error in 200 steps")

    def _check_all_coordinates(self, car, context, fail_on_nan=True):
        """Check all coordinates in a car for NaN/inf values."""
        for i, (body, shape) in enumerate(car.frame):
            pos = body.position
            vel = body.velocity
            
            # Check for NaN
            if math.isnan(pos.x) or math.isnan(pos.y):
                msg = f"{context} - frame {i} has NaN position: {pos}"
                if fail_on_nan:
                    self.fail(msg)
                else:
                    print(f"    WARNING: {msg}")
            
            if math.isnan(vel.x) or math.isnan(vel.y):
                msg = f"{context} - frame {i} has NaN velocity: {vel}"
                if fail_on_nan:
                    self.fail(msg)
                else:
                    print(f"    WARNING: {msg}")
            
            # Check for infinite values
            if math.isinf(pos.x) or math.isinf(pos.y):
                msg = f"{context} - frame {i} has infinite position: {pos}"
                if fail_on_nan:
                    self.fail(msg)
                else:
                    print(f"    WARNING: {msg}")
            
            if math.isinf(vel.x) or math.isinf(vel.y):
                msg = f"{context} - frame {i} has infinite velocity: {vel}"
                if fail_on_nan:
                    self.fail(msg)
                else:
                    print(f"    WARNING: {msg}")

    def _has_nan_coordinates(self, car):
        """Check if any car coordinates are NaN."""
        for body, shape in car.frame:
            pos = body.position
            vel = body.velocity
            
            if (math.isnan(pos.x) or math.isnan(pos.y) or 
                math.isnan(vel.x) or math.isnan(vel.y)):
                return True
        return False

    def _detailed_coordinate_dump(self, car, space, step):
        """Dump detailed coordinate information for debugging."""
        print(f"\n    === DETAILED COORDINATE DUMP (Step {step}) ===")
        
        # Check car coordinates
        for i, (body, shape) in enumerate(car.frame):
            pos = body.position
            vel = body.velocity
            print(f"    Car frame {i}:")
            print(f"      Position: {pos} (x={pos.x}, y={pos.y})")
            print(f"      Velocity: {vel} (x={vel.x}, y={vel.y})")
            print(f"      Body mass: {body.mass}, moment: {body.moment}")
            
            # Check if it's a wheel with motor
            for part in car.frame_parts:
                if hasattr(part, 'wheel_body') and part.wheel_body == body:
                    print(f"      Wheel motor rate: {part.motor.rate}")
                    print(f"      Wheel motor max_force: {part.motor.max_force}")
                    break
        
        # Check all bodies in space
        print(f"    All bodies in space ({len(space.bodies)}):")
        for i, body in enumerate(space.bodies):
            pos = body.position
            vel = body.velocity
            print(f"      Body {i}: pos={pos}, vel={vel}")


if __name__ == "__main__":
    unittest.main(verbosity=2)