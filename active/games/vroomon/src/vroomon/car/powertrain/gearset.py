"""Gearset powertrain part for transforming torque and wheel output."""

import random

from . import PowertrainPart


class GearSet(PowertrainPart):
    """Ratio-transforming gear stage with wheel output split."""

    def __init__(self, input_ratio, wheel_proportion, output_ratio):
        """Initialize a gear set with input ratio, wheel proportion, and output ratio."""
        self.input_ratio = max(input_ratio, 0.1)
        self.wheel_proportion = wheel_proportion
        self.output_ratio = max(output_ratio, 0.1)

    @classmethod
    def from_random(cls, params=None):
        """Create a gear set with random parameters based on normal distribution."""
        if params is None:
            params = {"input": (1, 1), "wheel": (0.5, 0.1), "output": (1, 1)}
        input_mu, input_sigma = params["input"]
        wheel_mu, wheel_sigma = params["wheel"]
        output_mu, output_sigma = params["output"]
        return cls(
            random.normalvariate(input_mu, input_sigma),
            random.normalvariate(wheel_mu, wheel_sigma),
            random.normalvariate(output_mu, output_sigma),
        )

    def to_dna(self):
        """Convert the gear set to DNA format."""
        return {
            "type": "G",
            "input_ratio": self.input_ratio,
            "wheel_proportion": self.wheel_proportion,
            "output_ratio": self.output_ratio,
        }

    @classmethod
    def from_dna(cls, dna):
        """Create a gear set from DNA."""
        return cls(dna["input_ratio"], dna["wheel_proportion"], dna["output_ratio"])
