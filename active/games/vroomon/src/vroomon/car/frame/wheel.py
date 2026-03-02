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

    def __init__(self, body, pos, drive, size):
        """Initialize a wheel frame part."""
        self.power, self.torque = drive
        self.size = self._validate_size(size)
        self.body = body
        self.pos = pos
        self.build_wheel()

    @classmethod
    def from_random(cls, car_body, pos, power, torque):
        """Create a wheel with a random size."""
        size = abs(random.normalvariate(10, 5))
        size = max(size, 1.0)
        return cls(car_body, pos, (power, torque), size)

    def mutate(self):
        """Mutate the wheel by changing its size and power."""
        self.size = abs(random.normalvariate(10, 5))
        self.size = max(self.size, 1.0)
        self.build_wheel()

    def build_wheel(self):
        """Build the wheel body and shape."""
        self.power = self._validate_power(self.power)
        self.torque = self._validate_torque(self.torque)

        wheel_body = pymunk.Body()
        wheel_body.position = (self.pos.x, 10)

        circle = pymunk.Circle(wheel_body, self.size)
        circle.density = 1
        circle.filter = pymunk.ShapeFilter(group=1)
        circle.friction = 0.5

        area = 3.14159 * self.size * self.size
        mass = area * circle.density
        moment = pymunk.moment_for_circle(mass, 0, self.size)

        if mass <= 0 or math.isnan(mass) or math.isinf(mass):
            logger.warning(f"Invalid wheel mass {mass}, using default mass 10.0")
            mass = 10.0
            moment = pymunk.moment_for_circle(mass, 0, self.size)

        wheel_body.mass = mass
        wheel_body.moment = moment

        pivot = pymunk.PivotJoint(
            self.body, wheel_body, (self.pos.x, self.pos.y), (0, 0)
        )
        pivot.collide_bodies = False

        rate = -self.power / self.size
        rate = self._validate_rate(rate)
        logger.debug(f"Rate: {rate}")

        if abs(self.power) < 0.001:
            logger.debug("Zero-power wheel detected, disabling motor to prevent NaN physics")
            motor = pymunk.SimpleMotor(self.body, wheel_body, 0.0)
            motor.max_force = 0.0
        else:
            max_force = self._validate_torque(self.torque)
            motor = pymunk.SimpleMotor(self.body, wheel_body, rate)
            motor.max_force = max_force

        self.physics = _WheelPhysics(wheel_body, circle, pivot, motor)

    @property
    def wheel_body(self):
        """Backwards-compatible accessor for wheel body."""
        return self.physics.body

    @property
    def circle(self):
        """Backwards-compatible accessor for wheel shape."""
        return self.physics.circle

    @property
    def pivot(self):
        """Backwards-compatible accessor for wheel pivot joint."""
        return self.physics.pivot

    @property
    def motor(self):
        """Backwards-compatible accessor for wheel motor."""
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
        return cls(body, pos, (dna["power"], dna["torque"]), dna["size"])

    def _validate_size(self, size):
        """Validate and sanitize wheel size to prevent physics crashes."""
        if math.isnan(size):
            logger.warning("NaN wheel size detected, using default size 5.0")
            return 5.0

        if math.isinf(size):
            logger.warning("Infinite wheel size detected, using default size 5.0")
            return 5.0

        if size <= 0:
            logger.warning(f"Invalid wheel size {size} detected, using minimum size 1.0")
            return 1.0

        if size < 0.1:
            logger.warning(f"Very small wheel size {size} detected, using minimum size 1.0")
            return 1.0

        if size > 50.0:
            logger.warning(f"Very large wheel size {size} detected, clamping to 50.0")
            return 50.0

        return size

    def _validate_power(self, power):
        """Validate and sanitize wheel power to prevent NaN/infinite values."""
        if math.isnan(power):
            logger.warning("NaN wheel power detected, using 0.0")
            return 0.0

        if math.isinf(power):
            logger.warning("Infinite wheel power detected, clamping to ±1000.0")
            return 1000.0 if power > 0 else -1000.0

        if abs(power) > 10000.0:
            logger.warning(f"Extreme wheel power {power} detected, clamping to ±10000.0")
            return 10000.0 if power > 0 else -10000.0

        return power

    def _validate_torque(self, torque):
        """Validate and sanitize wheel torque to prevent NaN/infinite values."""
        if math.isnan(torque):
            logger.warning("NaN wheel torque detected, using 0.1")
            return 0.1

        if math.isinf(torque):
            logger.warning("Infinite wheel torque detected, using 1000.0")
            return 1000.0

        if torque <= 0:
            logger.debug(f"Zero/negative torque {torque} detected, using minimum 0.1")
            return 0.1

        if torque > 50000.0:
            logger.warning(f"Extreme wheel torque {torque} detected, clamping to 50000.0")
            return 50000.0

        return torque

    def _validate_rate(self, rate):
        """Validate and sanitize motor rate to prevent NaN/infinite values."""
        if math.isnan(rate):
            logger.warning("NaN motor rate detected, using 0.0")
            return 0.0

        if math.isinf(rate):
            logger.warning("Infinite motor rate detected, clamping to ±1000.0")
            return 1000.0 if rate > 0 else -1000.0

        if abs(rate) > 1000.0:
            logger.warning(f"Extreme motor rate {rate} detected, clamping to ±1000.0")
            return 1000.0 if rate > 0 else -1000.0

        return rate
