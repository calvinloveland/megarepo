"""DriveShaft just transfers power."""

import random

from vroomon.car.powertrain import PowertrainPart


class DriveShaft(PowertrainPart):
    def __init__(self, efficiency):
        """Initialize a drive shaft with a given efficiency."""
        self.efficiency = efficiency

    @classmethod
    def from_random(cls, efficiency_mu=0.9, efficiency_sigma=0.1):
        """Create a drive shaft with random efficiency based on normal distribution."""
        return cls(random.normalvariate(efficiency_mu, efficiency_sigma))

    def to_dna(self):
        """Convert the drive shaft to DNA format."""
        return {"type": "D", "efficiency": self.efficiency}

    @classmethod
    def from_dna(cls, dna):
        """Create a drive shaft from DNA."""
        return cls(dna["efficiency"])
