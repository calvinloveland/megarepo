"""Test basic pygame and pymunk integration to isolate visualization issues."""

import unittest
import pygame
import pymunk
import pymunk.pygame_util
import math


class TestPygamePymunkIntegration(unittest.TestCase):
    """Test basic pygame and pymunk integration."""

    def setUp(self):
        """Set up test environment."""
        pygame.init()
        self.screen = pygame.Surface((800, 600))
        
    def tearDown(self):
        """Clean up pygame."""
        pygame.quit()

    def test_simple_falling_box(self):
        """Test a simple falling box scenario with pygame visualization."""
        print("\n=== Testing Simple Falling Box ===")
        
        # Create pymunk space
        space = pymunk.Space()
        space.gravity = (0, -981)  # Earth gravity
        
        # Create a falling box
        box_body = pymunk.Body(1, pymunk.moment_for_box(1, (50, 50)))
        box_body.position = 400, 500  # Start at top of screen
        box_shape = pymunk.Poly.create_box(box_body, (50, 50))
        box_shape.friction = 0.3
        space.add(box_body, box_shape)
        
        # Create ground
        ground_body = pymunk.Body(body_type=pymunk.Body.STATIC)
        ground_shape = pymunk.Segment(ground_body, (0, 100), (800, 100), 5)
        ground_shape.friction = 0.7
        space.add(ground_body, ground_shape)
        
        # Create pygame drawing options
        draw_options = pymunk.pygame_util.DrawOptions(self.screen)
        
        # Simulate for several steps
        for step in range(600):  # 2 seconds at 60 FPS
            # Step physics
            space.step(1/60.0)
            
            # Validate coordinates
            pos = box_body.position
            vel = box_body.velocity
            
            self.assertFalse(math.isnan(pos.x), f"Box position.x became NaN at step {step}: {pos}")
            self.assertFalse(math.isnan(pos.y), f"Box position.y became NaN at step {step}: {pos}")
            self.assertFalse(math.isnan(vel.x), f"Box velocity.x became NaN at step {step}: {vel}")
            self.assertFalse(math.isnan(vel.y), f"Box velocity.y became NaN at step {step}: {vel}")
            
            # Test drawing every 10 steps
            if step % 10 == 0:
                try:
                    self.screen.fill((255, 255, 255))  # White background
                    space.debug_draw(draw_options)
                    print(f"Step {step}: Box at {pos}, velocity {vel}")
                except Exception as e:
                    self.fail(f"Drawing failed at step {step}: {e}")
        
        # Verify the box settled on the ground (y position should be around 125)
        final_pos = box_body.position
        self.assertGreater(final_pos.y, 120, "Box should have settled on the ground")
        self.assertLess(final_pos.y, 150, "Box should not be floating too high")
        
        print(f"Final position: {final_pos}")
        print("Simple falling box test completed successfully!")

    def test_multiple_objects_scene(self):
        """Test a scene with multiple objects to ensure no coordinate conflicts."""
        print("\n=== Testing Multiple Objects Scene ===")
        
        # Create pymunk space
        space = pymunk.Space()
        space.gravity = (0, -981)
        
        # Create multiple falling objects
        objects = []
        for i in range(5):
            # Create a box at different x positions
            body = pymunk.Body(1, pymunk.moment_for_box(1, (30, 30)))
            body.position = 100 + i * 120, 500
            shape = pymunk.Poly.create_box(body, (30, 30))
            shape.friction = 0.3
            space.add(body, shape)
            objects.append((body, shape))
        
        # Create ground
        ground_body = pymunk.Body(body_type=pymunk.Body.STATIC)
        ground_shape = pymunk.Segment(ground_body, (0, 100), (800, 100), 5)
        ground_shape.friction = 0.7
        space.add(ground_body, ground_shape)
        
        # Create pygame drawing options
        draw_options = pymunk.pygame_util.DrawOptions(self.screen)
        
        # Simulate and validate
        for step in range(180):  # 3 seconds
            space.step(1/60.0)
            
            # Validate all objects
            for i, (body, shape) in enumerate(objects):
                pos = body.position
                vel = body.velocity
                
                self.assertFalse(math.isnan(pos.x), f"Object {i} position.x became NaN at step {step}")
                self.assertFalse(math.isnan(pos.y), f"Object {i} position.y became NaN at step {step}")
                self.assertFalse(math.isnan(vel.x), f"Object {i} velocity.x became NaN at step {step}")
                self.assertFalse(math.isnan(vel.y), f"Object {i} velocity.y became NaN at step {step}")
            
            # Test drawing every 20 steps
            if step % 20 == 0:
                try:
                    self.screen.fill((255, 255, 255))
                    space.debug_draw(draw_options)
                    print(f"Step {step}: All {len(objects)} objects simulated successfully")
                except Exception as e:
                    self.fail(f"Drawing failed at step {step}: {e}")
        
        print("Multiple objects test completed successfully!")

    def test_circle_object(self):
        """Test with circular objects (similar to wheels)."""
        print("\n=== Testing Circle Object ===")
        
        # Create pymunk space
        space = pymunk.Space()
        space.gravity = (0, -981)
        
        # Create a falling circle
        circle_body = pymunk.Body(1, pymunk.moment_for_circle(1, 0, 25))
        circle_body.position = 400, 500
        circle_shape = pymunk.Circle(circle_body, 25)
        circle_shape.friction = 0.3
        space.add(circle_body, circle_shape)
        
        # Create angled ground
        ground_body = pymunk.Body(body_type=pymunk.Body.STATIC)
        ground_shape = pymunk.Segment(ground_body, (0, 100), (800, 200), 5)
        ground_shape.friction = 0.7
        space.add(ground_body, ground_shape)
        
        # Create pygame drawing options
        draw_options = pymunk.pygame_util.DrawOptions(self.screen)
        
        # Simulate and validate
        for step in range(300):  # 5 seconds - give time for rolling
            space.step(1/60.0)
            
            pos = circle_body.position
            vel = circle_body.velocity
            angular_vel = circle_body.angular_velocity
            
            # Check for NaN values
            self.assertFalse(math.isnan(pos.x), f"Circle position.x became NaN at step {step}")
            self.assertFalse(math.isnan(pos.y), f"Circle position.y became NaN at step {step}")
            self.assertFalse(math.isnan(vel.x), f"Circle velocity.x became NaN at step {step}")
            self.assertFalse(math.isnan(vel.y), f"Circle velocity.y became NaN at step {step}")
            self.assertFalse(math.isnan(angular_vel), f"Circle angular_velocity became NaN at step {step}")
            
            # Test drawing every 30 steps
            if step % 30 == 0:
                try:
                    self.screen.fill((255, 255, 255))
                    space.debug_draw(draw_options)
                    print(f"Step {step}: Circle at {pos}, rolling with angular velocity {angular_vel}")
                except Exception as e:
                    self.fail(f"Drawing failed at step {step}: {e}")
        
        print("Circle object test completed successfully!")

    def test_constrained_objects(self):
        """Test objects connected by constraints (joints/motors)."""
        print("\n=== Testing Constrained Objects ===")
        
        # Create pymunk space
        space = pymunk.Space()
        space.gravity = (0, -981)
        
        # Create two connected boxes
        body1 = pymunk.Body(1, pymunk.moment_for_box(1, (40, 40)))
        body1.position = 300, 400
        shape1 = pymunk.Poly.create_box(body1, (40, 40))
        shape1.friction = 0.3
        space.add(body1, shape1)
        
        body2 = pymunk.Body(1, pymunk.moment_for_box(1, (40, 40)))
        body2.position = 400, 400
        shape2 = pymunk.Poly.create_box(body2, (40, 40))
        shape2.friction = 0.3
        space.add(body2, shape2)
        
        # Connect them with a pin joint
        joint = pymunk.PinJoint(body1, body2, (20, 0), (-20, 0))
        space.add(joint)
        
        # Create ground
        ground_body = pymunk.Body(body_type=pymunk.Body.STATIC)
        ground_shape = pymunk.Segment(ground_body, (0, 100), (800, 100), 5)
        ground_shape.friction = 0.7
        space.add(ground_body, ground_shape)
        
        # Create pygame drawing options
        draw_options = pymunk.pygame_util.DrawOptions(self.screen)
        
        # Simulate and validate
        for step in range(240):  # 4 seconds
            space.step(1/60.0)
            
            # Validate both bodies
            for i, body in enumerate([body1, body2]):
                pos = body.position
                vel = body.velocity
                
                self.assertFalse(math.isnan(pos.x), f"Body {i} position.x became NaN at step {step}")
                self.assertFalse(math.isnan(pos.y), f"Body {i} position.y became NaN at step {step}")
                self.assertFalse(math.isnan(vel.x), f"Body {i} velocity.x became NaN at step {step}")
                self.assertFalse(math.isnan(vel.y), f"Body {i} velocity.y became NaN at step {step}")
            
            # Test drawing every 40 steps
            if step % 40 == 0:
                try:
                    self.screen.fill((255, 255, 255))
                    space.debug_draw(draw_options)
                    print(f"Step {step}: Constrained objects simulated successfully")
                except Exception as e:
                    self.fail(f"Drawing failed at step {step}: {e}")
        
        print("Constrained objects test completed successfully!")


if __name__ == "__main__":
    unittest.main(verbosity=2)