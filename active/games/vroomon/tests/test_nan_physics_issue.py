"""Unit test to track down the NaN physics error in the simulation."""

import unittest
import math
import pymunk
from vroomon.car.car import Car
from vroomon.simulation import Simulation
from vroomon.ground import Ground


class TestNaNPhysicsIssue(unittest.TestCase):
    """Test suite specifically targeting NaN physics errors."""

    def test_detect_nan_in_car_bodies(self):
        """Test to detect NaN values in car body positions and velocities."""
        dna = {"frame": ["R", "W"], "powertrain": ["C", "D"]}
        car = Car(dna)
        
        print("=== NaN Detection in Car Bodies ===")
        
        # Check initial state
        for i, (body, shape) in enumerate(car.frame):
            pos = body.position
            vel = body.velocity
            angular_vel = body.angular_velocity
            
            print(f"Frame part {i}:")
            print(f"  Position: {pos}")
            print(f"  Velocity: {vel}")
            print(f"  Angular velocity: {angular_vel}")
            
            # Check for NaN values
            if math.isnan(pos.x) or math.isnan(pos.y):
                self.fail(f"NaN found in body {i} position: {pos}")
            if math.isnan(vel.x) or math.isnan(vel.y):
                self.fail(f"NaN found in body {i} velocity: {vel}")
            if math.isnan(angular_vel):
                self.fail(f"NaN found in body {i} angular velocity: {angular_vel}")

    def test_detect_nan_after_physics_reset(self):
        """Test for NaN values after reset_physics() is called."""
        dna = {"frame": ["R", "W"], "powertrain": ["C", "D"]}
        car = Car(dna)
        
        print("=== NaN Detection After Physics Reset ===")
        
        # Reset physics
        car.reset_physics()
        
        # Check for NaN values after reset
        for i, (body, shape) in enumerate(car.frame):
            pos = body.position
            vel = body.velocity
            angular_vel = body.angular_velocity
            
            print(f"After reset - Frame part {i}:")
            print(f"  Position: {pos}")
            print(f"  Velocity: {vel}")
            print(f"  Angular velocity: {angular_vel}")
            
            # Check for NaN values
            if math.isnan(pos.x) or math.isnan(pos.y):
                self.fail(f"NaN found in body {i} position after reset: {pos}")
            if math.isnan(vel.x) or math.isnan(vel.y):
                self.fail(f"NaN found in body {i} velocity after reset: {vel}")
            if math.isnan(angular_vel):
                self.fail(f"NaN found in body {i} angular velocity after reset: {angular_vel}")

    def test_detect_nan_after_space_addition(self):
        """Test for NaN values after adding car to physics space."""
        dna = {"frame": ["R", "W"], "powertrain": ["C", "D"]}
        car = Car(dna)
        simulation = Simulation()
        
        print("=== NaN Detection After Space Addition ===")
        
        # Reset and add to space
        car.reset_physics()
        car.add_to_space(simulation.space)
        
        # Check for NaN values after space addition
        for i, (body, shape) in enumerate(car.frame):
            pos = body.position
            vel = body.velocity
            angular_vel = body.angular_velocity
            
            print(f"After space addition - Frame part {i}:")
            print(f"  Position: {pos}")
            print(f"  Velocity: {vel}")
            print(f"  Angular velocity: {angular_vel}")
            
            # Check for NaN values
            if math.isnan(pos.x) or math.isnan(pos.y):
                self.fail(f"NaN found in body {i} position after space addition: {pos}")
            if math.isnan(vel.x) or math.isnan(vel.y):
                self.fail(f"NaN found in body {i} velocity after space addition: {vel}")
            if math.isnan(angular_vel):
                self.fail(f"NaN found in body {i} angular velocity after space addition: {angular_vel}")

    def test_detect_nan_during_simulation_steps(self):
        """Test for NaN values during physics simulation steps."""
        dna = {"frame": ["R", "W"], "powertrain": ["C", "D"]}
        car = Car(dna)
        ground = Ground()
        simulation = Simulation()
        
        print("=== NaN Detection During Simulation Steps ===")
        
        # Setup simulation
        car.reset_physics()
        ground.add_to_space(simulation.space)
        car.add_to_space(simulation.space)
        
        # Run simulation steps and check for NaN after each step
        for step in range(100):  # Test first 100 steps
            # Take a physics step
            simulation.space.step(0.01)
            
            # Check all bodies for NaN values
            nan_found = False
            for i, (body, shape) in enumerate(car.frame):
                pos = body.position
                vel = body.velocity
                angular_vel = body.angular_velocity
                
                # Check for NaN values
                if math.isnan(pos.x) or math.isnan(pos.y):
                    print(f"NaN found at step {step} in body {i} position: {pos}")
                    nan_found = True
                if math.isnan(vel.x) or math.isnan(vel.y):
                    print(f"NaN found at step {step} in body {i} velocity: {vel}")
                    nan_found = True
                if math.isnan(angular_vel):
                    print(f"NaN found at step {step} in body {i} angular velocity: {angular_vel}")
                    nan_found = True
                    
                if nan_found:
                    print(f"Step {step} - Frame part {i} state:")
                    print(f"  Position: {pos}")
                    print(f"  Velocity: {vel}")
                    print(f"  Angular velocity: {angular_vel}")
                    print(f"  Mass: {body.mass}")
                    print(f"  Moment: {body.moment}")
                    self.fail(f"NaN detected at simulation step {step} in body {i}")
        
        print(f"Completed {step + 1} simulation steps without NaN errors")

    def test_wheel_motor_parameters_for_nan(self):
        """Test if wheel motor parameters can cause NaN values."""
        dna = {"frame": ["W"], "powertrain": ["C"]}
        car = Car(dna)
        
        print("=== Wheel Motor Parameters Check ===")
        
        # Check wheel parameters
        wheel_part = car.frame_parts[0]  # Should be a Wheel
        print(f"Wheel power: {wheel_part.power}")
        print(f"Wheel torque: {wheel_part.torque}")
        print(f"Wheel size: {wheel_part.size}")
        
        # Check if any are NaN or problematic
        if math.isnan(wheel_part.power):
            self.fail(f"Wheel power is NaN: {wheel_part.power}")
        if math.isnan(wheel_part.torque):
            self.fail(f"Wheel torque is NaN: {wheel_part.torque}")
        if math.isnan(wheel_part.size):
            self.fail(f"Wheel size is NaN: {wheel_part.size}")
            
        # Check if values are problematic (zero, negative, etc.)
        if wheel_part.torque <= 0:
            print(f"Warning: Wheel torque is <= 0: {wheel_part.torque}")
        if wheel_part.size <= 0:
            print(f"Warning: Wheel size is <= 0: {wheel_part.size}")
            
        # Check motor parameters
        if hasattr(wheel_part, 'motor') and wheel_part.motor:
            motor_rate = wheel_part.motor.rate
            motor_max_force = wheel_part.motor.max_force
            print(f"Motor rate: {motor_rate}")
            print(f"Motor max force: {motor_max_force}")
            
            if math.isnan(motor_rate):
                self.fail(f"Motor rate is NaN: {motor_rate}")
            if math.isnan(motor_max_force):
                self.fail(f"Motor max force is NaN: {motor_max_force}")

    def test_reproduce_creates_nan_values(self):
        """Test if the reproduce method creates cars with NaN physics values."""
        # Create parent cars
        car1_dna = {"frame": ["R", "W"], "powertrain": ["C", "D"]}
        car2_dna = {"frame": ["W", "R", "W"], "powertrain": ["D", "C", "G"]}
        
        car1 = Car(car1_dna)
        car2 = Car(car2_dna)
        
        print("=== Testing Reproduce Method for NaN Creation ===")
        
        # Check parents first
        self._check_car_for_nan(car1, "Parent car1")
        self._check_car_for_nan(car2, "Parent car2")
        
        # Create child through reproduction
        child = Car.reproduce(car1, car2)
        
        # Check child for NaN values
        self._check_car_for_nan(child, "Child car")

    def _check_car_for_nan(self, car, car_name):
        """Helper method to check a car for NaN values."""
        print(f"\nChecking {car_name}:")
        
        # Check main body
        if hasattr(car, 'body') and car.body:
            pos = car.body.position
            vel = car.body.velocity
            print(f"  Main body position: {pos}")
            print(f"  Main body velocity: {vel}")
            
            if math.isnan(pos.x) or math.isnan(pos.y):
                self.fail(f"NaN in {car_name} main body position: {pos}")
            if math.isnan(vel.x) or math.isnan(vel.y):
                self.fail(f"NaN in {car_name} main body velocity: {vel}")
        
        # Check frame parts
        for i, (body, shape) in enumerate(car.frame):
            pos = body.position
            vel = body.velocity
            angular_vel = body.angular_velocity
            
            print(f"  Frame part {i} position: {pos}")
            print(f"  Frame part {i} velocity: {vel}")
            
            if math.isnan(pos.x) or math.isnan(pos.y):
                self.fail(f"NaN in {car_name} frame part {i} position: {pos}")
            if math.isnan(vel.x) or math.isnan(vel.y):
                self.fail(f"NaN in {car_name} frame part {i} velocity: {vel}")
            if math.isnan(angular_vel):
                self.fail(f"NaN in {car_name} frame part {i} angular velocity: {angular_vel}")

    def test_score_car_simulation_for_nan(self):
        """Test the full score_car simulation process for NaN generation."""
        dna = {"frame": ["R", "W"], "powertrain": ["C", "D"]}
        car = Car(dna)
        ground = Ground()
        simulation = Simulation()
        
        print("=== Testing Full score_car Simulation ===")
        
        # Check car before simulation
        self._check_car_for_nan(car, "Car before simulation")
        
        try:
            # Run the actual scoring simulation
            score = simulation.score_car(car, ground, visualize=False)
            print(f"Simulation completed with score: {score}")
            
            # Check car after simulation
            self._check_car_for_nan(car, "Car after simulation")
            
        except Exception as e:
            print(f"Simulation failed with error: {e}")
            # Check if the error is related to NaN values
            if "nan" in str(e).lower() or "NaN" in str(e):
                print("Error appears to be NaN-related!")
            
            # Check car state when error occurred
            self._check_car_for_nan(car, "Car when error occurred")
            raise

    def test_multiple_cars_simulation_for_nan(self):
        """Test simulating multiple cars for NaN issues."""
        cars = [
            Car({"frame": ["R"], "powertrain": ["C"]}),
            Car({"frame": ["W"], "powertrain": ["D"]}),
            Car({"frame": ["R", "W"], "powertrain": ["C", "D"]}),
        ]
        
        ground = Ground()
        simulation = Simulation()
        
        print("=== Testing Multiple Cars Simulation ===")
        
        # Check all cars before simulation
        for i, car in enumerate(cars):
            self._check_car_for_nan(car, f"Car {i} before simulation")
        
        try:
            # Run population scoring
            results = simulation.score_population(cars, ground, visualize=False)
            print(f"Population simulation completed with {len(results)} results")
            
            # Check all cars after simulation
            for i, car in enumerate(cars):
                self._check_car_for_nan(car, f"Car {i} after simulation")
                
        except Exception as e:
            print(f"Population simulation failed with error: {e}")
            
            # Check all cars when error occurred
            for i, car in enumerate(cars):
                try:
                    self._check_car_for_nan(car, f"Car {i} when error occurred")
                except Exception as check_error:
                    print(f"Error checking car {i}: {check_error}")
            raise

    def test_zero_power_wheel_causes_nan(self):
        """Test that specifically targets the zero power wheel NaN issue."""
        # Car 1 from the failing test: wheel with driveshaft powertrain
        dna = {"frame": ["W"], "powertrain": ["D"]}
        car = Car(dna)
        
        print("=== Zero Power Wheel NaN Test ===")
        
        # Check the wheel's power calculation
        wheel_part = car.frame_parts[0]
        print(f"Wheel power: {wheel_part.power}")
        print(f"Wheel torque: {wheel_part.torque}")
        print(f"Wheel size: {wheel_part.size}")
        print(f"Motor rate: {wheel_part.motor.rate}")
        print(f"Motor max_force: {wheel_part.motor.max_force}")
        
        # This should be the problematic configuration:
        # - DriveShaft alone provides no power (starts with 0)
        # - Wheel motor rate becomes 0 / size = 0
        # - But torque is still applied via motor.max_force
        
        # Test single car simulation
        ground = Ground()
        simulation = Simulation()
        
        print("Testing single car simulation...")
        try:
            score = simulation.score_car(car, ground, visualize=False)
            print(f"Single car simulation completed with score: {score}")
            self._check_car_for_nan(car, "Car after single simulation")
        except Exception as e:
            print(f"Single car simulation failed: {e}")
            self._check_car_for_nan(car, "Car when single simulation failed")
            
        # Reset the car and test in population simulation
        print("\nTesting in population simulation...")
        car = Car(dna)  # Fresh car
        cars = [car]
        simulation = Simulation()  # Fresh simulation
        
        try:
            results = simulation.score_population(cars, ground, visualize=False)
            print(f"Population simulation completed with results: {results}")
            self._check_car_for_nan(car, "Car after population simulation")
        except Exception as e:
            print(f"Population simulation failed: {e}")
            self._check_car_for_nan(car, "Car when population simulation failed")
            
    def test_powertrain_power_calculation_debug(self):
        """Debug the power calculation for different powertrains."""
        test_cases = [
            {"frame": ["W"], "powertrain": ["C"]},  # Cylinder - should have power
            {"frame": ["W"], "powertrain": ["D"]},  # DriveShaft - zero power
            {"frame": ["W"], "powertrain": ["G"]},  # GearSet - zero power  
        ]
        
        print("=== Powertrain Power Calculation Debug ===")
        
        for i, dna in enumerate(test_cases):
            print(f"\nTest case {i}: {dna}")
            car = Car(dna)
            
            # Debug the power calculation
            power, torque = car.calculate_wheel_power(0)
            print(f"Calculated power: {power}")
            print(f"Calculated torque: {torque}")
            
            # Check the actual wheel
            wheel = car.frame_parts[0]
            print(f"Wheel power: {wheel.power}")
            print(f"Wheel torque: {wheel.torque}")
            print(f"Motor rate: {wheel.motor.rate}")
            print(f"Motor max_force: {wheel.motor.max_force}")
            
            # The issue is likely when power=0 but torque>0, creating motor rate=0 but force>0