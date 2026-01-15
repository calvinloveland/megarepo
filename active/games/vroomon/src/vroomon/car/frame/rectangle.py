"""Rectangle frame part for Vroomon car simulation."""

import random
import math

import pymunk


def create_box_with_offset(body, size, offset):
    """Create a rectangle shape with a given size and offset from the body's position."""
    width, height = size
    hw, hh = width / 2, height / 2
    # Create vertices relative to the center, then add the offset.
    vertices = [
        (-hw + offset[0], -hh + offset[1]),
        (hw + offset[0], -hh + offset[1]),
        (hw + offset[0], hh + offset[1]),
        (-hw + offset[0], hh + offset[1]),
    ]
    return pymunk.Poly(body, vertices)


class Rectangle:
    """Rectangle frame part of the car."""

    def __init__(self, body, pos, length=None, height=None):
        """Initialize a rectangle frame part with variable dimensions."""
        self.body = body
        # Use provided dimensions or generate from normal distribution
        self.length = length if length is not None else self._generate_length()
        self.height = height if height is not None else self._generate_height()
        
        # Validate dimensions to prevent physics issues
        self.length = self._validate_dimension(self.length, default=10.0, name="length")
        self.height = self._validate_dimension(self.height, default=5.0, name="height")
        
        self.polygon = create_box_with_offset(body, (self.length, self.height), (pos.x, pos.y))
        self.polygon.density = 1
        self.polygon.color = (random.randrange(256), random.randrange(256), 255, 200)
        self.polygon.filter = pymunk.ShapeFilter(group=1)

    def _generate_length(self, length_mu=10.0, length_sigma=3.0):
        """Generate rectangle length using normal distribution."""
        return abs(random.normalvariate(length_mu, length_sigma))

    def _generate_height(self, height_mu=5.0, height_sigma=1.5):
        """Generate rectangle height using normal distribution."""
        return abs(random.normalvariate(height_mu, height_sigma))

    def _validate_dimension(self, dimension, default, name):
        """Validate and sanitize rectangle dimensions to prevent physics issues."""
        # Handle NaN dimensions
        if math.isnan(dimension):
            print(f"Warning: NaN rectangle {name} detected, using default {default}")
            return default
        
        # Handle infinite dimensions
        if math.isinf(dimension):
            print(f"Warning: Infinite rectangle {name} detected, using default {default}")
            return default
        
        # Handle zero or negative dimensions
        if dimension <= 0:
            print(f"Warning: Invalid rectangle {name} {dimension} detected, using minimum 1.0")
            return 1.0
        
        # Handle extremely small dimensions that could cause numerical issues
        if dimension < 0.5:
            print(f"Warning: Very small rectangle {name} {dimension} detected, using minimum 1.0")
            return 1.0
        
        # Handle extremely large dimensions
        max_size = 50.0
        if dimension > max_size:
            print(f"Warning: Very large rectangle {name} {dimension} detected, clamping to {max_size}")
            return max_size
        
        return dimension

    def mutate(self):
        """Mutate the rectangle by changing its color and dimensions."""
        # Change the color of the rectangle
        self.polygon.color = (random.randrange(256), random.randrange(256), 255, 200)
        
        # Mutate dimensions using normal distribution
        self.length = self._validate_dimension(self._generate_length(), default=10.0, name="length")
        self.height = self._validate_dimension(self._generate_height(), default=5.0, name="height")
        
        # Rebuild the polygon with new dimensions
        # Note: This creates a new polygon but keeps the same body
        old_polygon = self.polygon
        self.polygon = create_box_with_offset(self.body, (self.length, self.height), (0, 0))
        self.polygon.density = old_polygon.density
        self.polygon.color = old_polygon.color
        self.polygon.filter = old_polygon.filter

    @classmethod
    def from_random(cls, body, pos):
        """Create a rectangle with random dimensions."""
        return cls(body, pos)

    def to_dna(self):
        """Convert the rectangle to DNA format."""
        return {
            "type": "R",
            "length": self.length,
            "height": self.height
        }

    @classmethod
    def from_dna(cls, body, pos, dna=None):
        """Create a rectangle from DNA."""
        if dna is None:
            # Fallback for old DNA format that only has type
            return cls(body, pos)
        
        # New DNA format with dimensions
        length = dna.get("length")
        height = dna.get("height")
        return cls(body, pos, length, height)
