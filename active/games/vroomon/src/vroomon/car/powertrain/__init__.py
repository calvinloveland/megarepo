"""Powertrain module for Vroomon car simulation."""


class PowertrainPart:
    def to_dna(self):
        """Convert the powertrain part to DNA format."""
        raise NotImplementedError

    @classmethod
    def from_dna(cls, dna):
        """Create a powertrain part from DNA."""
        raise NotImplementedError
