# pylint: disable=too-few-public-methods
"""Ground module: generate and add terrain to physics simulation."""

import random

import pymunk


class Ground:
    """Represent the terrain as a series of line segments based on generated points."""

    def __init__(self):
        """Generate random ground points with increasing variation."""

        def generate_points():
            """Generate a list of (x, y) points for the ground terrain."""
            points = []
            previous = 200
            for i in range(100):
                variation = random.normalvariate(0, 1 + i)
                previous = previous + variation
                points.append((i * 50, previous))
            return points

        self.points = generate_points()

    def add_to_space(self, space):
        """Add the ground segments to the given Pymunk physics space."""
        # Create a static ground as a line segment.
        static_body = space.static_body
        for i in range(len(self.points) - 1):
            start = self.points[i]
            end = self.points[i + 1]
            ground_shape = pymunk.Segment(static_body, start, end, 5)
            ground_shape.friction = 1.0
            space.add(ground_shape)
