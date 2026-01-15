"""Unit test that demonstrates the zero-power wheel NaN physics bug."""

import unittest
import math
from vroomon.car.car import Car
from vroomon.simulation import Simulation
from vroomon.ground import Ground


class TestZeroPowerWheelBug(unittest.TestCase):
    """Test suite that demonstrates and documents the zero-power wheel NaN bug."""

    def test_zero_power_wheel_nan_bug_demonstration(self):
        """
        Verify that the zero-power wheel NaN bug has been fixed.
        
        Previously, wheels with zero power but non-zero torque would cause NaN physics.
        After the fix, these configurations should work safely.
        """
        print("=== Zero Power Wheel NaN Bug - Verification of Fix ===")
        
        # The previously problematic configurations:
        problematic_cars = [
            {"frame": ["W"], "powertrain": ["D"]},  # DriveShaft only = 0 power
            {"frame": ["W"], "powertrain": ["G"]},  # GearSet only = 0 power  
        ]
        
        for i, dna in enumerate(problematic_cars):
            print(f"\nTesting previously problematic car {i}: {dna}")
            car = Car(dna)
            
            # Show the configuration after our fix
            wheel = car.frame_parts[0]
            power, torque = car.calculate_wheel_power(0)
            
            print(f"Power calculation result: power={power}, torque={torque}")
            print(f"Wheel power: {wheel.power}")
            print(f"Wheel torque: {wheel.torque}")
            print(f"Motor rate: {wheel.motor.rate}")
            print(f"Motor max_force: {wheel.motor.max_force}")
            
            # Verify the fix: zero-power wheels should have motor force set to 0
            self.assertEqual(wheel.power, 0.0, "Wheel should have zero power")
            self.assertGreater(wheel.torque, 0, "Wheel should have non-zero torque")
            self.assertEqual(wheel.motor.rate, 0.0, "Motor rate should be zero")
            self.assertEqual(wheel.motor.max_force, 0.0, "Motor force should now be zero (fix applied)")
            
            # After the fix, this should work without NaN
            simulation = Simulation()
            ground = Ground()
            
            try:
                score = simulation.score_car(car, ground, visualize=False)
                print(f"✅ Fixed! Car {i} simulation succeeded with score: {score}")
                
                # Verify no NaN values after simulation
                for body, shape in car.frame:
                    vel = body.velocity
                    pos = body.position
                    self.assertFalse(math.isnan(vel.x), f"Car {i} should not have NaN velocity.x: {vel}")
                    self.assertFalse(math.isnan(vel.y), f"Car {i} should not have NaN velocity.y: {vel}")
                    self.assertFalse(math.isnan(pos.x), f"Car {i} should not have NaN position.x: {pos}")
                    self.assertFalse(math.isnan(pos.y), f"Car {i} should not have NaN position.y: {pos}")
                
                self.assertFalse(math.isnan(score), f"Car {i} score should not be NaN: {score}")
                
            except Exception as e:
                self.fail(f"Car {i} should work after fix, but failed: {e}")

    def test_working_wheel_configurations(self):
        """Test wheel configurations that should work without NaN errors."""
        print("\n=== Working Wheel Configurations ===")
        
        working_cars = [
            {"frame": ["W"], "powertrain": ["C"]},  # Cylinder = has power
            {"frame": ["W", "R"], "powertrain": ["C", "D"]},  # Cylinder + DriveShaft = has power (fixed lengths)
            {"frame": ["W", "R"], "powertrain": ["C", "G"]},  # Cylinder + GearSet = has power (fixed lengths)
        ]
        
        for i, dna in enumerate(working_cars):
            print(f"\nTesting working car {i}: {dna}")
            car = Car(dna)
            
            wheel = car.frame_parts[0]  # First part should be a wheel
            power, torque = car.calculate_wheel_power(0)
            
            print(f"Power calculation result: power={power}, torque={torque}")
            print(f"Wheel power: {wheel.power}")
            print(f"Motor rate: {wheel.motor.rate}")
            
            # These should have non-zero power and work fine
            self.assertGreater(abs(wheel.power), 0.001, f"Car {i} should have non-zero power")
            
            # Test simulation - should work without NaN
            simulation = Simulation()
            ground = Ground()
            
            try:
                score = simulation.score_car(car, ground, visualize=False)
                print(f"Working car {i} simulation succeeded with score: {score}")
                
                # Verify no NaN values
                for body, shape in car.frame:
                    vel = body.velocity
                    self.assertFalse(math.isnan(vel.x), f"Car {i} has NaN in velocity.x: {vel}")
                    self.assertFalse(math.isnan(vel.y), f"Car {i} has NaN in velocity.y: {vel}")
                    
            except Exception as e:
                self.fail(f"Working car {i} should not fail in simulation: {e}")

    def test_bug_fix_verification_template(self):
        """
        Template test that will pass once the zero-power wheel bug is fixed.
        
        This test should fail now but pass after implementing the fix.
        """
        print("\n=== Bug Fix Verification Template ===")
        
        # Previously problematic configurations
        test_cars = [
            {"frame": ["W"], "powertrain": ["D"]},
            {"frame": ["W"], "powertrain": ["G"]},
            {"frame": ["W", "R"], "powertrain": ["D", "C"]},  # Mixed config
        ]
        
        for i, dna in enumerate(test_cars):
            print(f"\nTesting car {i} (should work after fix): {dna}")
            car = Car(dna)
            
            simulation = Simulation()
            ground = Ground()
            
            try:
                score = simulation.score_car(car, ground, visualize=False)
                print(f"Car {i} simulation succeeded with score: {score}")
                
                # After fix, no car should have NaN values
                for j, (body, shape) in enumerate(car.frame):
                    vel = body.velocity
                    pos = body.position
                    
                    self.assertFalse(math.isnan(vel.x), 
                                   f"Car {i} frame {j} has NaN velocity.x after fix: {vel}")
                    self.assertFalse(math.isnan(vel.y), 
                                   f"Car {i} frame {j} has NaN velocity.y after fix: {vel}")
                    self.assertFalse(math.isnan(pos.x), 
                                   f"Car {i} frame {j} has NaN position.x after fix: {pos}")
                    self.assertFalse(math.isnan(pos.y), 
                                   f"Car {i} frame {j} has NaN position.y after fix: {pos}")
                    
                # Score should be a valid number
                self.assertFalse(math.isnan(score), f"Car {i} score should not be NaN: {score}")
                self.assertFalse(math.isinf(score), f"Car {i} score should not be infinite: {score}")
                
            except Exception as e:
                # After the fix, these should not fail
                self.fail(f"Car {i} should work after bug fix, but failed with: {e}")


if __name__ == "__main__":
    unittest.main(verbosity=2)