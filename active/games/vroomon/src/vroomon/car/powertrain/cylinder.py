"""Cylinder creates power for the car."""

import random

from vroomon.car.powertrain import PowertrainPart


class Cylinder(PowertrainPart):
    def __init__(self, power):
        """Initialize a cylinder with a given power."""
        self.power = power

    @classmethod
    def from_random(cls, power_mu=100, power_sigma=0.25):
        """Create a cylinder with random power based on normal distribution."""
        return cls(random.normalvariate(power_mu, power_sigma))

    def to_dna(self):
        """Convert the cylinder to DNA format."""
        return {"type": "C", "power": self.power}

    @classmethod
    def from_dna(cls, dna):
        """Create a cylinder from DNA."""
        return cls(dna["power"])
