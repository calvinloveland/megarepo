"""Unit tests to debug the Chipmunk physics error."""

import unittest
import pymunk
from vroomon.car.car import Car
from vroomon.simulation import Simulation
from vroomon.ground import Ground
from vroomon.car.frame.rectangle import Rectangle
from vroomon.car.frame.wheel import Wheel


class TestPhysicsDebug(unittest.TestCase):
    """Test suite to debug pymunk physics issues."""

    def test_basic_rectangle_creation(self):
        """Test that a Rectangle can be created without errors."""
        body = pymunk.Body()
        body.position = (10, 10)
        pos = type('Position', (), {'x': 0, 'y': 0})()
        
        rectangle = Rectangle(body, pos)
        
        # Verify the rectangle was created properly
        self.assertIsNotNone(rectangle.polygon)
        self.assertEqual(rectangle.polygon.body, body)
        self.assertIsNotNone(rectangle.polygon.body)
        print(f"Rectangle body: {rectangle.polygon.body}")
        print(f"Rectangle body position: {rectangle.polygon.body.position}")

    def test_basic_wheel_creation(self):
        """Test that a Wheel can be created without errors."""
        body = pymunk.Body()
        body.position = (10, 10)
        pos = type('Position', (), {'x': 0, 'y': 0})()
        
        wheel = Wheel(body, pos, power=10, torque=5, size=15)
        
        # Verify the wheel was created properly
        self.assertIsNotNone(wheel.wheel_body)
        self.assertIsNotNone(wheel.circle)
        self.assertIsNotNone(wheel.circle.body)
        print(f"Wheel body: {wheel.wheel_body}")
        print(f"Wheel circle body: {wheel.circle.body}")

    def test_car_creation_basic(self):
        """Test basic car creation with minimal DNA."""
        dna = {"frame": ["R"], "powertrain": ["C"]}
        
        try:
            car = Car(dna)
            print(f"Car created successfully with {len(car.frame)} frame parts")
            print(f"Car main body: {car.body}")
            
            # Check frame parts
            for i, (body, shape) in enumerate(car.frame):
                print(f"Frame part {i}: body={body}, shape={shape}")
                print(f"  Body position: {body.position}")
                print(f"  Shape body: {shape.body}")
                self.assertIsNotNone(body, f"Body {i} should not be None")
                self.assertIsNotNone(shape, f"Shape {i} should not be None")
                self.assertIsNotNone(shape.body, f"Shape {i} body should not be None")
                
        except Exception as e:
            self.fail(f"Car creation failed: {e}")

    def test_car_creation_with_wheel(self):
        """Test car creation with both rectangle and wheel."""
        dna = {"frame": ["R", "W"], "powertrain": ["C", "D"]}
        
        try:
            car = Car(dna)
            print(f"Car with wheel created successfully with {len(car.frame)} frame parts")
            
            # Check all frame parts
            for i, (body, shape) in enumerate(car.frame):
                print(f"Frame part {i}: body={body}, shape={shape}")
                print(f"  Body position: {body.position}")
                print(f"  Shape body: {shape.body}")
                self.assertIsNotNone(body, f"Body {i} should not be None")
                self.assertIsNotNone(shape, f"Shape {i} should not be None")
                self.assertIsNotNone(shape.body, f"Shape {i} body should not be None")
                
        except Exception as e:
            self.fail(f"Car creation with wheel failed: {e}")

    def test_space_addition_step_by_step(self):
        """Test adding car parts to space step by step."""
        dna = {"frame": ["R"], "powertrain": ["C"]}
        car = Car(dna)
        space = pymunk.Space()
        
        print("Testing space addition step by step...")
        
        # Test adding bodies first
        unique_bodies = set()
        for body, shape in car.frame:
            print(f"Processing: body={body}, shape={shape}")
            print(f"  Shape body: {shape.body}")
            
            # Verify shape has a valid body
            self.assertIsNotNone(shape.body, "Shape body should not be None")
            
            if body not in unique_bodies:
                unique_bodies.add(body)
                print(f"  Adding body to space: {body}")
                try:
                    space.add(body)
                    print(f"  Body added successfully")
                except Exception as e:
                    self.fail(f"Failed to add body to space: {e}")
            
            print(f"  Adding shape to space: {shape}")
            try:
                space.add(shape)
                print(f"  Shape added successfully")
            except Exception as e:
                self.fail(f"Failed to add shape to space: {e}")

    def test_reset_physics_functionality(self):
        """Test the reset_physics method doesn't break body references."""
        dna = {"frame": ["R", "W"], "powertrain": ["C", "D"]}
        car = Car(dna)
        
        print("Testing reset_physics functionality...")
        
        # Verify initial state
        for i, (body, shape) in enumerate(car.frame):
            print(f"Before reset - Frame part {i}: body={body}, shape.body={shape.body}")
            self.assertIsNotNone(shape.body, f"Shape {i} body should not be None before reset")
        
        # Reset physics
        car.reset_physics()
        
        # Verify state after reset
        for i, (body, shape) in enumerate(car.frame):
            print(f"After reset - Frame part {i}: body={body}, shape.body={shape.body}")
            self.assertIsNotNone(shape.body, f"Shape {i} body should not be None after reset")
            self.assertEqual(body, shape.body, f"Body and shape.body should match for part {i}")

    def test_multiple_space_additions(self):
        """Test adding the same car to multiple spaces sequentially."""
        dna = {"frame": ["R"], "powertrain": ["C"]}
        car = Car(dna)
        
        print("Testing multiple space additions...")
        
        for space_num in range(3):
            print(f"\n--- Testing space {space_num + 1} ---")
            space = pymunk.Space()
            
            # Reset physics before adding to new space
            car.reset_physics()
            
            # Verify bodies are still valid after reset
            for i, (body, shape) in enumerate(car.frame):
                print(f"Space {space_num + 1} - Frame part {i}: body={body}, shape.body={shape.body}")
                self.assertIsNotNone(shape.body, f"Shape {i} body should not be None")
            
            # Try to add to space
            try:
                car.add_to_space(space)
                print(f"Successfully added car to space {space_num + 1}")
            except Exception as e:
                self.fail(f"Failed to add car to space {space_num + 1}: {e}")

    def test_simulation_single_step(self):
        """Test a single simulation step to isolate the error."""
        dna = {"frame": ["R"], "powertrain": ["C"]}
        car = Car(dna)
        ground = Ground()
        simulation = Simulation()
        
        print("Testing single simulation step...")
        
        try:
            # Reset physics
            car.reset_physics()
            print("Physics reset completed")
            
            # Add ground first
            ground.add_to_space(simulation.space)
            print("Ground added to space")
            
            # Verify car state before adding
            for i, (body, shape) in enumerate(car.frame):
                print(f"Before adding - Frame part {i}: body={body}, shape.body={shape.body}")
                self.assertIsNotNone(shape.body, f"Shape {i} body should not be None")
            
            # Add car
            car.add_to_space(simulation.space)
            print("Car added to space successfully")
            
            # Try one simulation step
            simulation.space.step(0.01)
            print("Simulation step completed successfully")
            
        except Exception as e:
            print(f"Simulation test failed: {e}")
            # Print detailed debug info
            for i, (body, shape) in enumerate(car.frame):
                print(f"Debug - Frame part {i}:")
                print(f"  body: {body}")
                print(f"  shape: {shape}")
                print(f"  shape.body: {getattr(shape, 'body', 'NO BODY ATTR')}")
            raise


if __name__ == "__main__":
    unittest.main(verbosity=2)