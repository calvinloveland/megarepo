"""Wheel class for Vroomon car frame parts."""

import random
import math
from dataclasses import dataclass

import pymunk
from loguru import logger


@dataclass
class _WheelPhysics:
    """Physics properties of the wheel."""

    body: pymunk.Body
    circle: pymunk.Circle
    pivot: pymunk.PivotJoint
    motor: pymunk.SimpleMotor


class Wheel:
    """Wheel frame part of the car."""

    SEQUENCE_LENGTH = 3

    def __init__(self, body, pos, power, torque, size):
        """Initialize a wheel frame part."""
        self.power = power
        self.torque = torque
        # CRITICAL FIX: Validate and sanitize wheel size to prevent crashes
        self.size = self._validate_size(size)
        self.body = body
        self.pos = pos
        self.build_wheel()

    @classmethod
    def from_random(cls, car_body, pos, power, torque):
        """Create a wheel with a random size."""
        # Ensure wheel size is always positive to prevent NaN physics
        size = abs(random.normalvariate(10, 5))
        # Add minimum size constraint to prevent extremely small wheels
        size = max(size, 1.0)
        return cls(car_body, pos, power, torque, size)

    def mutate(self):
        """Mutate the wheel by changing its size and power."""
        # Ensure wheel size is always positive to prevent NaN physics
        self.size = abs(random.normalvariate(10, 5))
        # Add minimum size constraint to prevent extremely small wheels
        self.size = max(self.size, 1.0)
        self.build_wheel()

    def build_wheel(self):
        """Build the wheel body and shape."""
        # Validate and sanitize power and torque to prevent NaN/infinite values
        self.power = self._validate_power(self.power)
        self.torque = self._validate_torque(self.torque)
        
        # build them locally
        wheel_body = pymunk.Body()
        wheel_body.position = (self.pos.x, 10)

        circle = pymunk.Circle(wheel_body, self.size)
        circle.density = 1
        circle.filter = pymunk.ShapeFilter(group=1)
        circle.friction = 0.5

        # Fix NaN physics: Ensure wheel body has valid mass and moment
        # Calculate mass based on circle area and density
        area = 3.14159 * self.size * self.size  # π * r²
        mass = area * circle.density
        moment = pymunk.moment_for_circle(mass, 0, self.size)

        # Additional safety: Ensure mass and moment are valid
        if mass <= 0 or math.isnan(mass) or math.isinf(mass):
            logger.warning(f"Invalid wheel mass {mass}, using default mass 10.0")
            mass = 10.0
            moment = pymunk.moment_for_circle(mass, 0, self.size)

        # Set the body's mass and moment to prevent NaN physics
        wheel_body.mass = mass
        wheel_body.moment = moment

        pivot = pymunk.PivotJoint(
            self.body, wheel_body, (self.pos.x, self.pos.y), (0, 0)
        )
        pivot.collide_bodies = False

        # CRITICAL FIX: Safe rate calculation to prevent division by zero
        # Since we've validated self.size to be >= 1.0, this is now safe
        rate = -self.power / self.size
        
        # Additional safety: Validate the calculated rate
        rate = self._validate_rate(rate)
        logger.debug(f"Rate: {rate}")

        # Prevent NaN values by handling zero-power wheels specially
        # The root cause is motors with rate=0 but max_force>0 create unstable physics
        if abs(self.power) < 0.001:  # Essentially zero power
            # For zero-power wheels, don't create a motor at all to prevent NaN physics
            logger.debug(f"Zero-power wheel detected, disabling motor to prevent NaN physics")
            motor = pymunk.SimpleMotor(self.body, wheel_body, 0.0)
            motor.max_force = 0.0  # No force applied
        else:
            # Normal powered wheel - validate max_force before setting
            max_force = self._validate_torque(self.torque)
            motor = pymunk.SimpleMotor(self.body, wheel_body, rate)
            motor.max_force = max_force

        # collapse into one field
        self.physics = _WheelPhysics(wheel_body, circle, pivot, motor)

    # expose the old names as properties
    @property
    def wheel_body(self):
        return self.physics.body

    @property
    def circle(self):
        return self.physics.circle

    @property
    def pivot(self):
        return self.physics.pivot

    @property
    def motor(self):
        return self.physics.motor

    def to_dna(self):
        """Convert the wheel to DNA format."""
        return {
            "type": "W",
            "power": self.power,
            "torque": self.torque,
            "size": self.size,
        }

    @classmethod
    def from_dna(cls, body, pos, dna):
        """Create a wheel from DNA."""
        return cls(body, pos, dna["power"], dna["torque"], dna["size"])

    def _validate_size(self, size):
        """Validate and sanitize wheel size to prevent physics crashes."""
        # Handle NaN sizes
        if math.isnan(size):
            logger.warning(f"NaN wheel size detected, using default size 5.0")
            return 5.0
        
        # Handle infinite sizes
        if math.isinf(size):
            logger.warning(f"Infinite wheel size detected, using default size 5.0")
            return 5.0
        
        # Handle zero or negative sizes
        if size <= 0:
            logger.warning(f"Invalid wheel size {size} detected, using minimum size 1.0")
            return 1.0
        
        # Handle extremely small sizes that could cause numerical issues
        if size < 0.1:
            logger.warning(f"Very small wheel size {size} detected, using minimum size 1.0")
            return 1.0
        
        # Handle extremely large sizes
        if size > 50.0:
            logger.warning(f"Very large wheel size {size} detected, clamping to 50.0")
            return 50.0
        
        return size

    def _validate_power(self, power):
        """Validate and sanitize wheel power to prevent NaN/infinite values."""
        if math.isnan(power):
            logger.warning(f"NaN wheel power detected, using 0.0")
            return 0.0
        
        if math.isinf(power):
            logger.warning(f"Infinite wheel power detected, clamping to ±1000.0")
            return 1000.0 if power > 0 else -1000.0
        
        # Clamp extreme values
        if abs(power) > 10000.0:
            logger.warning(f"Extreme wheel power {power} detected, clamping to ±10000.0")
            return 10000.0 if power > 0 else -10000.0
        
        return power

    def _validate_torque(self, torque):
        """Validate and sanitize wheel torque to prevent NaN/infinite values."""
        if math.isnan(torque):
            logger.warning(f"NaN wheel torque detected, using 0.1")
            return 0.1
        
        if math.isinf(torque):
            logger.warning(f"Infinite wheel torque detected, using 1000.0")
            return 1000.0
        
        # Ensure minimum positive torque
        if torque <= 0:
            logger.debug(f"Zero/negative torque {torque} detected, using minimum 0.1")
            return 0.1
        
        # Clamp extreme values
        if torque > 50000.0:
            logger.warning(f"Extreme wheel torque {torque} detected, clamping to 50000.0")
            return 50000.0
        
        return torque

    def _validate_rate(self, rate):
        """Validate and sanitize motor rate to prevent NaN/infinite values."""
        if math.isnan(rate):
            logger.warning(f"NaN motor rate detected, using 0.0")
            return 0.0
        
        if math.isinf(rate):
            logger.warning(f"Infinite motor rate detected, clamping to ±1000.0")
            return 1000.0 if rate > 0 else -1000.0
        
        # Clamp extreme values to prevent physics instability
        if abs(rate) > 1000.0:
            logger.warning(f"Extreme motor rate {rate} detected, clamping to ±1000.0")
            return 1000.0 if rate > 0 else -1000.0
        
        return rate
