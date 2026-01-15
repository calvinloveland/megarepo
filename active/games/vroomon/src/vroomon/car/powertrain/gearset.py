import random

from vroomon.car.powertrain import PowertrainPart


class GearSet(PowertrainPart):
    def __init__(self, input_ratio, wheel_proportion, output_ratio):
        """Initialize a gear set with input ratio, wheel proportion, and output ratio."""
        self.input_ratio = max(input_ratio, 0.1)
        self.wheel_proportion = wheel_proportion
        self.output_ratio = max(output_ratio, 0.1)

    @classmethod
    def from_random(
        cls,
        input_mu=1,
        input_sigma=1,
        wheel_mu=0.5,
        wheel_sigma=0.1,
        output_mu=1,
        output_sigma=1,
    ):
        """Create a gear set with random parameters based on normal distribution."""
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
