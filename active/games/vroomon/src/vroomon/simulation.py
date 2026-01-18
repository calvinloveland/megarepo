# pylint: disable=no-member
"""Simulation module: run physics-based simulation for cars on ground."""

import math

import pygame
import pymunk
import pymunk.pygame_util
from loguru import logger


class Simulation:
    """Run physics simulation and score cars."""

    def __init__(self):
        """Initialize the physics space with gravity."""
        self.space = pymunk.Space()
        self.space.gravity = (0, 9.8)

    def score_car(self, car, ground, visualize=False):
        """Simulate a single car and return its vertical score."""
        # handle empty car DNA: no parts
        if not car.frame or not car.powertrain:
            return 0

        # Reset car physics state before adding to new space
        car.reset_physics()
        if visualize:
            logger.debug("Resetting car physics state before simulation")

        if visualize:
            DISPLAY_WIDTH_HEIGHT = (600, 600)
            logger.debug('Initializing pygame for visualization')
            pygame.init()
            screen = pygame.display.set_mode((DISPLAY_WIDTH_HEIGHT))
            pygame.display.set_caption("Car Simulation")
            clock = pygame.time.Clock()
            draw_options = pymunk.pygame_util.DrawOptions(screen)
            
        # Add the car and ground to the simulation
        car.add_to_space(self.space)
        ground.add_to_space(self.space)

        # Run the simulation for a few steps
        running = True
        sim_length = 60 # seconds
        fps = 60
        steps = sim_length * fps  # Total steps based on simulation length and FPS
        dt = 1 / fps  # Time step for each frame
        for step in range(steps):
            if visualize:
                for event in pygame.event.get():
                    if event.type == pygame.QUIT:
                        running = False
                if not running:
                    break


            self.space.step(dt)
            if visualize:
                # Check for NaN coordinates before attempting to draw
                nan_detected = False
                for body in self.space.bodies:
                    pos = body.position
                    if hasattr(pos, 'x') and hasattr(pos, 'y'):
                        if math.isnan(pos.x) or math.isnan(pos.y):
                            logger.warning(f"NaN coordinates detected at step {step}, skipping visualization")
                            nan_detected = True
                            break
                
                if not nan_detected:
                    try:
                        screen.fill((255, 255, 255))
                        self.space.debug_draw(draw_options)
                        pygame.display.flip()
                        clock.tick(fps)
                    except (TypeError, ValueError) as e:
                        logger.warning(f"Drawing error at step {step}: {e}")
                        # Continue simulation without visualization
                        visualize = False

        # Calculate score based on car's position and velocity
        score = car.get_y_position()  # Y position

        # Clean up pygame if we were visualizing
        if visualize:
            pygame.quit()

        # Remove car from space when done to prevent conflicts
        try:
            for body, shape in car.frame:
                if body in self.space.bodies:
                    self.space.remove(body, shape)
            for joint in car.joints:
                if joint in self.space.constraints:
                    self.space.remove(joint)
            for motor in car.motors:
                if motor in self.space.constraints:
                    self.space.remove(motor)
        except Exception as e:
            logger.debug(f"Error removing car from space: {e}")

        return score

    def score_population(self, cars, ground, visualize=False):
        """Simulate multiple cars and return list of (car, score)."""
        if not cars:
            return []
        # Reset space for this batch simulation
        self.space = pymunk.Space()
        self.space.gravity = (0, 9.8)
        
        # Reset physics state for all cars before adding to space
        for car in cars:
            car.reset_physics()
            
        if visualize:
            pygame.init()
            screen = pygame.display.set_mode((600, 600))
            pygame.display.set_caption("Population Simulation")
            clock = pygame.time.Clock()
            draw_options = pymunk.pygame_util.DrawOptions(screen)
            
        # Add ground first
        ground.add_to_space(self.space)
        # Add all cars
        for car in cars:
            car.add_to_space(self.space)
        running = True
        # Run simulation steps
        for step in range(10000):
            if visualize:
                for event in pygame.event.get():
                    if event.type == pygame.QUIT:
                        running = False
                if not running:
                    break
            for _ in range(10):
                self.space.step(0.01)
            if visualize:
                # Check for NaN coordinates before attempting to draw
                nan_detected = False
                for body in self.space.bodies:
                    pos = body.position
                    if hasattr(pos, 'x') and hasattr(pos, 'y'):
                        import math
                        if math.isnan(pos.x) or math.isnan(pos.y):
                            logger.warning(f"NaN coordinates detected at step {step}, disabling visualization")
                            nan_detected = True
                            break
                
                if not nan_detected:
                    try:
                        screen.fill((255, 255, 255))
                        self.space.debug_draw(draw_options)
                        pygame.display.flip()
                        clock.tick(60)
                    except (TypeError, ValueError) as e:
                        logger.warning(f"Drawing error at step {step}: {e}")
                        # Continue simulation without visualization
                        visualize = False
                else:
                    # Continue simulation without visualization if NaN detected
                    visualize = False
        
        # Clean up pygame if we were visualizing
        if visualize:
            pygame.quit()
            
        # Collect scores: vertical position of each car
        return [(car, car.get_y_position()) for car in cars]
