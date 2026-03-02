"""Simulation module: run physics-based simulation for cars on ground."""

import math
import importlib

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
        if not car.frame or not car.powertrain:
            return 0

        car.reset_physics()
        visual_state = self._start_visualization("Car Simulation") if visualize else None
        car.add_to_space(self.space)
        ground.add_to_space(self.space)
        self._run_visualized_steps(steps=60 * 60, dt=1 / 60, visual_state=visual_state)
        score = car.get_y_position()
        self._stop_visualization(visual_state)
        self._remove_car_from_space(car)
        return score

    def score_population(self, cars, ground, visualize=False):
        """Simulate multiple cars and return list of (car, score)."""
        if not cars:
            return []

        self.space = pymunk.Space()
        self.space.gravity = (0, 9.8)
        for car in cars:
            car.reset_physics()

        visual_state = (
            self._start_visualization("Population Simulation") if visualize else None
        )
        ground.add_to_space(self.space)
        for car in cars:
            car.add_to_space(self.space)

        for _ in range(10000):
            self._run_visualized_steps(steps=10, dt=0.01, visual_state=visual_state)
            if visual_state is not None and not visual_state["running"]:
                break

        self._stop_visualization(visual_state)
        return [(car, car.get_y_position()) for car in cars]

    def _start_visualization(self, caption):
        pygame = importlib.import_module("pygame")
        pygame.init()
        screen = pygame.display.set_mode((600, 600))
        pygame.display.set_caption(caption)
        return {
            "pygame": pygame,
            "screen": screen,
            "clock": pygame.time.Clock(),
            "draw_options": pymunk.pygame_util.DrawOptions(screen),
            "running": True,
            "enabled": True,
        }

    @staticmethod
    def _stop_visualization(visual_state):
        if visual_state is not None:
            visual_state["pygame"].quit()

    def _run_visualized_steps(self, steps, dt, visual_state):
        for step in range(steps):
            if visual_state is not None:
                self._process_events(visual_state)
                if not visual_state["running"]:
                    break
            self.space.step(dt)
            self._draw_space(step, visual_state)

    @staticmethod
    def _process_events(visual_state):
        pygame = visual_state["pygame"]
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                visual_state["running"] = False

    def _draw_space(self, step, visual_state):
        if visual_state is None or not visual_state["enabled"]:
            return
        pygame = visual_state["pygame"]
        if self._has_nan_coordinates():
            logger.warning(
                "NaN coordinates detected at step %s, disabling visualization",
                step,
            )
            visual_state["enabled"] = False
            return
        try:
            visual_state["screen"].fill((255, 255, 255))
            self.space.debug_draw(visual_state["draw_options"])
            pygame.display.flip()
            visual_state["clock"].tick(60)
        except (TypeError, ValueError) as error:
            logger.warning("Drawing error at step %s: %s", step, error)
            visual_state["enabled"] = False

    def _has_nan_coordinates(self):
        for body in self.space.bodies:
            pos = body.position
            if hasattr(pos, "x") and hasattr(pos, "y"):
                if math.isnan(pos.x) or math.isnan(pos.y):
                    return True
        return False

    def _remove_car_from_space(self, car):
        for body, shape in car.frame:
            if shape in self.space.shapes:
                self.space.remove(shape)
            if body in self.space.bodies:
                self.space.remove(body)
        for joint in car.joints:
            if joint in self.space.constraints:
                self.space.remove(joint)
        for motor in car.motors:
            if motor in self.space.constraints:
                self.space.remove(motor)
