"""Unit tests to identify the specific motor configuration causing NaN physics."""

import unittest
import math
import pymunk
from vroomon.car.car import Car
from vroomon.car.frame.wheel import Wheel
from vroomon.car.powertrain.cylinder import Cylinder
from vroomon.car.powertrain.driveshaft import DriveShaft
from vroomon.car.powertrain.gearset import GearSet


class TestMotorConfigurationBug(unittest.TestCase):
    """Test suite to identify problematic motor configurations that cause NaN."""

    def test_motor_parameter_combinations(self):
        """Test various motor rate and force combinations to find the problematic one."""
        print("=== Testing Motor Parameter Combinations ===")
        
        # Test different motor configurations - avoid setting NaN directly in pymunk
        test_configs = [
            {"rate": 0.0, "max_force": 0.0, "name": "Zero rate, zero force"},
            {"rate": 0.0, "max_force": 100.0, "name": "Zero rate, non-zero force - SUSPECT"},
            {"rate": 10.0, "max_force": 0.0, "name": "Non-zero rate, zero force"},
            {"rate": 10.0, "max_force": 100.0, "name": "Non-zero rate, non-zero force"},
            # Skip NaN tests for direct pymunk operations to avoid crashes
        ]
        
        for config in test_configs:
            print(f"\nTesting: {config['name']}")
            print(f"  rate={config['rate']}, max_force={config['max_force']}")
            
            with self.subTest(config=config['name']):
                # Create a minimal physics simulation
                space = pymunk.Space()
                space.gravity = (0, -981)
                
                # Create a wheel body
                wheel_body = pymunk.Body(1, pymunk.moment_for_circle(1, 0, 10))
                wheel_body.position = (50, 100)
                wheel_shape = pymunk.Circle(wheel_body, 10)
                wheel_shape.friction = 0.7
                
                # Create motor with test configuration - only use valid values
                try:
                    motor = pymunk.SimpleMotor(wheel_body, space.static_body, config['rate'])
                    motor.max_force = config['max_force']
                    
                    space.add(wheel_body, wheel_shape, motor)
                    
                    # Run simulation for a few steps
                    for step in range(20):
                        space.step(1/60.0)
                        
                        pos = wheel_body.position
                        vel = wheel_body.velocity
                        
                        # Check for NaN after each step
                        if math.isnan(pos.x) or math.isnan(pos.y):
                            self.fail(f"Position became NaN at step {step} with {config['name']}: {pos}")
                        
                        if math.isnan(vel.x) or math.isnan(vel.y):
                            self.fail(f"Velocity became NaN at step {step} with {config['name']}: {vel}")
                    
                    print(f"  Configuration survived 20 simulation steps")
                    
                except Exception as e:
                    print(f"  Configuration failed with exception: {e}")
                    self.fail(f"Unexpected failure for {config['name']}: {e}")

    def test_nan_input_validation(self):
        """Test that our validation functions handle NaN inputs correctly."""
        print("\n=== Testing NaN Input Validation ===")
        
        # Create a minimal wheel for testing validation functions
        import pymunk
        body = pymunk.Body(body_type=pymunk.Body.STATIC)
        pos = pymunk.Vec2d(0, 0)
        wheel = Wheel(body, pos, 0.0, 10.0, 5.0)
        
        # Test NaN power validation
        validated_power = wheel._validate_power(float('nan'))
        self.assertFalse(math.isnan(validated_power))
        self.assertEqual(validated_power, 0.0)
        print(f"NaN power validation: {float('nan')} -> {validated_power}")
        
        # Test NaN torque validation
        validated_torque = wheel._validate_torque(float('nan'))
        self.assertFalse(math.isnan(validated_torque))
        self.assertEqual(validated_torque, 0.1)
        print(f"NaN torque validation: {float('nan')} -> {validated_torque}")
        
        # Test NaN rate validation
        validated_rate = wheel._validate_rate(float('nan'))
        self.assertFalse(math.isnan(validated_rate))
        self.assertEqual(validated_rate, 0.0)
        print(f"NaN rate validation: {float('nan')} -> {validated_rate}")
        
        # Test infinite values
        validated_power_inf = wheel._validate_power(float('inf'))
        self.assertFalse(math.isinf(validated_power_inf))
        print(f"Infinite power validation: {float('inf')} -> {validated_power_inf}")
        
        validated_torque_inf = wheel._validate_torque(float('inf'))
        self.assertFalse(math.isinf(validated_torque_inf))
        print(f"Infinite torque validation: {float('inf')} -> {validated_torque_inf}")
        
        print("All validation functions correctly handle NaN/infinite inputs")

    def test_zero_power_wheel_creation(self):
        """Test the exact wheel creation process that leads to zero power wheels."""
        print("\n=== Testing Zero Power Wheel Creation ===")
        
        # Test the problematic DNA configurations
        problematic_dnas = [
            {"frame": ["W"], "powertrain": ["D"]},  # DriveShaft only
            {"frame": ["W"], "powertrain": ["G"]},  # GearSet only
        ]
        
        for i, dna in enumerate(problematic_dnas):
            print(f"\nTesting DNA {i}: {dna}")
            
            car = Car(dna)
            
            # Analyze the power calculation
            power, torque = car.calculate_wheel_power(0)  # For first wheel
            print(f"  Power calculation: power={power}, torque={torque}")
            
            # Get the actual wheel
            wheel = car.frame_parts[0]
            print(f"  Wheel power: {wheel.power}")
            print(f"  Wheel torque: {wheel.torque}")
            print(f"  Motor rate: {wheel.motor.rate}")
            print(f"  Motor max_force: {wheel.motor.max_force}")
            
            # This is the problematic combination we suspect
            if wheel.power == 0.0 and wheel.motor.max_force > 0:
                print(f"  *** FOUND PROBLEMATIC COMBINATION ***")
                print(f"  Zero power but non-zero motor force!")
                
                # Test this configuration in isolation
                space = pymunk.Space()
                space.gravity = (0, -981)
                
                # Add a ground
                ground_body = pymunk.Body(body_type=pymunk.Body.STATIC)
                ground_shape = pymunk.Segment(ground_body, (0, 0), (200, 0), 5)
                space.add(ground_body, ground_shape)
                
                # Add the car
                for body, shape in car.frame:
                    space.add(body, shape)
                
                # Run simulation and watch for NaN
                nan_detected = False
                for step in range(50):
                    space.step(1/60.0)
                    
                    for body, shape in car.frame:
                        pos = body.position
                        vel = body.velocity
                        
                        if math.isnan(pos.x) or math.isnan(pos.y) or math.isnan(vel.x) or math.isnan(vel.y):
                            print(f"    NaN detected at step {step}!")
                            print(f"    Position: {pos}, Velocity: {vel}")
                            nan_detected = True
                            break
                    
                    if nan_detected:
                        break
                
                if nan_detected:
                    print("  *** CONFIRMED: This configuration causes NaN ***")
                else:
                    print("  Surprisingly, no NaN detected in 50 steps")

    def test_powertrain_power_calculation(self):
        """Test power calculations for different powertrain configurations."""
        print("\n=== Testing Powertrain Power Calculations ===")
        
        # Test different powertrain configurations by creating cars and checking power
        test_cases = [
            {"frame": ["W"], "powertrain": ["C"], "name": "Cylinder only"},
            {"frame": ["W"], "powertrain": ["D"], "name": "DriveShaft only"},
            {"frame": ["W"], "powertrain": ["G"], "name": "GearSet only"},
            {"frame": ["W", "R"], "powertrain": ["C", "D"], "name": "Cylinder + DriveShaft"},
        ]
        
        for case in test_cases:
            print(f"\nTesting {case['name']}: {case}")
            # Create car with just the DNA parts, not the whole case dict
            car_dna = {"frame": case["frame"], "powertrain": case["powertrain"]}
            car = Car(car_dna)
            
            # Use the car's actual power calculation method
            power, torque = car.calculate_wheel_power(0)  # For first wheel
            print(f"  Calculated power: {power}, torque: {torque}")
            
            # Validate the values
            self.assertFalse(math.isnan(power), f"{case['name']} power should not be NaN")
            self.assertFalse(math.isnan(torque), f"{case['name']} torque should not be NaN")
            self.assertFalse(math.isinf(power), f"{case['name']} power should not be infinite")
            self.assertFalse(math.isinf(torque), f"{case['name']} torque should not be infinite")
            
            # Check if this is a zero-power configuration
            if case['name'] in ['DriveShaft only', 'GearSet only']:
                print(f"  WARNING: {case['name']} produces zero power (expected)")
                self.assertEqual(power, 0.0, f"{case['name']} should produce zero power")
            else:
                print(f"  {case['name']} produces non-zero power (good)")
                self.assertNotEqual(power, 0.0, f"{case['name']} should produce non-zero power")

    def test_wheel_motor_setup_isolation(self):
        """Test wheel motor setup in complete isolation."""
        print("\n=== Testing Wheel Motor Setup Isolation ===")
        
        # Test the exact process of creating a wheel with zero power
        print("Creating wheel with zero power configuration...")
        
        # Instead of trying to use non-existent methods, use car power calculation
        car_dna = {"frame": ["W"], "powertrain": ["D"]}  # DriveShaft only
        car = Car(car_dna)
        
        # Get power calculation from the car (this is the real approach)
        power, torque = car.calculate_wheel_power(0)  # For first wheel
        print(f"Car power calculation: power={power}, torque={torque}")
        
        # Get the actual wheel that was created
        wheel = car.frame_parts[0]
        print(f"Wheel power: {wheel.power}, Wheel torque: {wheel.torque}")
        print(f"Wheel motor rate: {wheel.motor.rate}")
        print(f"Wheel motor max_force: {wheel.motor.max_force}")
        
        # This is the exact problematic state
        self.assertEqual(wheel.power, 0.0)
        self.assertGreater(wheel.torque, 0.0)
        self.assertEqual(wheel.motor.rate, 0.0)  # rate = power / size
        # Note: Our fix should now set max_force to 0.0 for zero-power wheels
        self.assertEqual(wheel.motor.max_force, 0.0)  # Should be disabled by our fix
        
        # Test this motor configuration directly
        space = pymunk.Space()
        space.gravity = (0, -981)
        
        # Create bodies - use wheel.size instead of wheel.radius
        wheel_body = pymunk.Body(1, pymunk.moment_for_circle(1, 0, wheel.size))
        wheel_body.position = (50, 100)
        wheel_shape = pymunk.Circle(wheel_body, wheel.size)
        wheel_shape.friction = 0.7
        
        # Ground
        ground_body = pymunk.Body(body_type=pymunk.Body.STATIC)
        ground_shape = pymunk.Segment(ground_body, (0, 50), (200, 50), 5)
        ground_shape.friction = 0.7
        
        # Motor with our fixed configuration (should be safe now)
        motor = pymunk.SimpleMotor(wheel_body, ground_body, wheel.motor.rate)  # rate = 0
        motor.max_force = wheel.motor.max_force  # Should be 0.0 now
        
        space.add(wheel_body, wheel_shape, ground_body, ground_shape, motor)
        
        print("Running isolated motor test...")
        
        # Run and check for NaN
        for step in range(30):
            space.step(1/60.0)
            
            pos = wheel_body.position
            vel = wheel_body.velocity
            
            if math.isnan(pos.x) or math.isnan(pos.y):
                print(f"NaN in position at step {step}: {pos}")
                self.fail(f"NaN detected in position at step {step}")
                break
            
            if math.isnan(vel.x) or math.isnan(vel.y):
                print(f"NaN in velocity at step {step}: {vel}")
                self.fail(f"NaN detected in velocity at step {step}")
                break
            
            if step % 10 == 0:
                print(f"  Step {step}: pos={pos}, vel={vel}")
        
        print("Isolated motor test completed successfully - no NaN detected")


if __name__ == "__main__":
    unittest.main(verbosity=2)