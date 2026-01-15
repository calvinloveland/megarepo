"""Car module: defines the Car class with powertrain and frame building for simulation."""

import copy
import json
import random
from collections import namedtuple

import pymunk
from loguru import logger

from vroomon.car.frame.rectangle import Rectangle
from vroomon.car.frame.wheel import Wheel
from vroomon.car.powertrain.cylinder import Cylinder
from vroomon.car.powertrain.driveshaft import DriveShaft
from vroomon.car.powertrain.gearset import GearSet

Position = namedtuple("Position", ["x", "y"])


class Car:
    """Represent a car built from DNA with frame and powertrain parts."""

    FRAME_OFFSET = 10
    SEQUENCE_LENGTH = 3

    def calculate_wheel_power(self, wheel_position):
        """Compute power and torque delivered to the wheel at given index."""
        i = 0
        current_power = 0
        current_torque = 10000
        for powertrain_item in self.powertrain:
            logger.debug(f"Current power {current_power}, torque {current_torque}")
            if isinstance(powertrain_item, Cylinder):
                current_power += powertrain_item.power
            elif isinstance(powertrain_item, DriveShaft):
                current_power *= powertrain_item.efficiency
                current_torque *= powertrain_item.efficiency
            elif isinstance(powertrain_item, GearSet):
                current_power *= powertrain_item.input_ratio
                current_torque /= powertrain_item.input_ratio
                if i == wheel_position:
                    return (
                        current_power * powertrain_item.wheel_proportion,
                        current_torque * powertrain_item.wheel_proportion,
                    )
                current_power = current_power - (
                    current_power * powertrain_item.wheel_proportion
                )
                current_torque = current_torque - (
                    current_torque * powertrain_item.wheel_proportion
                )

                current_power *= powertrain_item.output_ratio
                current_torque /= powertrain_item.output_ratio
            else:
                raise ValueError(f"Unknown powertrain part: {powertrain_item}")
            if i == wheel_position:
                return (current_power, current_torque)
            i += 1
        # fallback return if no early return triggered
        return current_power, current_torque

    # pylint: disable=too-many-branches,too-many-statements
    def build_from_dna(self, dna):
        """Construct frame and powertrain parts from given DNA dict."""
        logger.debug(f"Car DNA: {dna}")
        self.frame = []
        self.powertrain = []
        self.joints = []
        self.motors = []
        self.frame_parts = []  # keep original part instances for DNA serialization
        self.body = pymunk.Body()  # Main body
        self.body.position = (10, 10)
        
        # Build powertrain and frame using helper methods
        self._build_powertrain(dna["powertrain"])
        self._build_frame(dna["frame"])
        
        # Fix NaN physics: Ensure main body always has valid mass and moment
        # This prevents NaN when the main body has no shapes (wheel-only cars)
        if self.body.mass == 0:
            self.body.mass = 10.0  # Reasonable default mass
            self.body.moment = 100.0  # Reasonable default moment
        
        if len(self.frame) == 0:
            raise ValueError("Frame must have at least one part")
        if len(self.powertrain) == 0:
            raise ValueError("Powertrain must have at least one part")
        if len(self.frame) != len(self.powertrain):
            raise ValueError("Frame and powertrain must have the same number of parts")

    def _build_powertrain(self, powertrain_dna):
        """Helper to build powertrain parts from DNA list"""
        new_format = bool(powertrain_dna) and isinstance(powertrain_dna[0], dict)
        for part_dna in powertrain_dna:
            part = self._create_powertrain_part(part_dna, new_format)
            self.powertrain.append(part)

    def _create_powertrain_part(self, part_dna, new_format):
        """Instantiate a single powertrain part based on DNA or code"""
        if new_format:
            mapping = {
                "C": Cylinder.from_dna,
                "D": DriveShaft.from_dna,
                "G": GearSet.from_dna,
            }
            try:
                return mapping[part_dna["type"]](part_dna)
            except KeyError:
                raise ValueError(
                    f"Unknown powertrain part type in DNA: {part_dna['type']}"
                )
        mapping = {
            "C": Cylinder.from_random,
            "D": DriveShaft.from_random,
            "G": GearSet.from_random,
        }
        try:
            return mapping[part_dna]()
        except KeyError:
            raise ValueError(f"Unknown powertrain part: {part_dna}")

    def _build_frame(self, frame_dna_list):
        """Helper to build frame parts from DNA list"""
        new_format = bool(frame_dna_list) and isinstance(frame_dna_list[0], dict)
        x = 0
        for frame_dna in frame_dna_list:
            pos = Position(x, 0)
            if new_format:
                part = self._create_frame_part_from_dna(self.body, pos, frame_dna)
            else:
                part = self._create_frame_part_random(self.body, pos, frame_dna)
            self.frame_parts.append(part)
            if isinstance(part, Rectangle):
                # For rectangles, use the main car body, not part.body
                self.frame.append((self.body, part.polygon))
            else:
                self.frame.append((part.wheel_body, part.circle))
                self.joints.append(part.pivot)
                self.motors.append(part.motor)
            x += self.FRAME_OFFSET

    def _create_frame_part_from_dna(self, body, pos, frame_dna):
        """Instantiate a frame part from DNA dict"""
        mapping = {
            "R": lambda bd, ps, fd: Rectangle.from_dna(bd, ps, fd),
            "W": lambda bd, ps, fd: Wheel.from_dna(bd, ps, fd),
        }
        try:
            return mapping[frame_dna["type"]](body, pos, frame_dna)
        except KeyError:
            raise ValueError(f"Unknown frame part type in DNA: {frame_dna['type']}")

    def _create_frame_part_random(self, body, pos, frame_dna):
        """Instantiate a legacy frame part by code"""
        if frame_dna == "R":
            return Rectangle(body, pos)
        if frame_dna == "W":
            idx = len(self.frame)
            power, torque = self.calculate_wheel_power(idx)
            return Wheel.from_random(body, pos, power, torque)
        raise ValueError(f"Unknown frame part: {frame_dna}")

    def __init__(self, dna=None):
        """Initialize a Car, optionally building from DNA."""
        self.frame = []
        self.powertrain = []
        if dna is not None:
            self.build_from_dna(dna)

    def add_to_space(self, space):
        """Add the car bodies, shapes, joints, and motors to the physics space."""
        for body, shape in self.frame:
            if body not in space._bodies:  # pylint: disable=protected-access
                space.add(body)
            space.add(shape)
        for joint in self.joints:
            space.add(joint)
        for motor in self.motors:
            space.add(motor)

    def get_y_position(self):
        """Return the vertical position of the front frame part."""
        logger.debug(f"Frame state: {self.frame}")
        return self.frame[0][0].position.y

    def reset_physics(self):
        """Reset all physics bodies to allow reuse in new spaces."""
        # The issue is that pymunk shapes can't be reused across spaces
        # We need to rebuild the entire frame with fresh physics components
        self._rebuild_frame_physics()

    def _rebuild_frame_physics(self):
        """Rebuild all frame physics components with fresh pymunk objects."""
        # Store the original frame parts for DNA serialization
        original_frame_parts = self.frame_parts.copy()

        # Clear existing physics components
        self.frame = []
        self.joints = []
        self.motors = []

        # Create a fresh main body
        self.body = pymunk.Body()
        self.body.position = (10, 10)

        # Rebuild frame with fresh physics components
        x = 0
        for part in original_frame_parts:
            pos = type('Position', (), {'x': x, 'y': 0})()

            if isinstance(part, Rectangle):
                # Create fresh rectangle with new body
                fresh_rect = Rectangle(self.body, pos)
                # Copy any properties we want to preserve
                fresh_rect.polygon.color = part.polygon.color
                # Update the original part's polygon reference
                part.polygon = fresh_rect.polygon
                self.frame.append((self.body, fresh_rect.polygon))

            elif isinstance(part, Wheel):
                # Create fresh wheel with new physics components
                fresh_wheel = Wheel(self.body, pos, part.power, part.torque, part.size)
                # Update the original part's physics references
                part.physics = fresh_wheel.physics
                self.frame.append((fresh_wheel.wheel_body, fresh_wheel.circle))
                self.joints.append(fresh_wheel.pivot)
                self.motors.append(fresh_wheel.motor)

            x += self.FRAME_OFFSET

        # Fix NaN physics: Ensure main body always has valid mass and moment after rebuild
        # This prevents NaN when the main body has no shapes (wheel-only cars)
        if self.body.mass == 0:
            self.body.mass = 10.0  # Reasonable default mass
            self.body.moment = 100.0  # Reasonable default moment

    def to_dna(self):
        """Serialize the car's parts to a DNA dictionary."""
        return {
            "powertrain": [pt.to_dna() for pt in self.powertrain],
            "frame": [part.to_dna() for part in self.frame_parts],
        }

    def save_dna(self, filepath):
        """Save the car DNA to a JSON file with UTF-8 encoding."""
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(self.to_dna(), f, indent=2)

    @classmethod
    def load_from_json(cls, filepath):
        """Load car DNA from a UTF-8 encoded JSON file and return a new Car."""
        with open(filepath, encoding="utf-8") as f:
            dna = json.load(f)
        return cls(dna)

    def mutate(self):
        """Return a new mutated Car instance based on this car's DNA."""
        replace_p = 0.10
        remove_p = 0.05
        insert_p = 0.05

        # extract DNA code lists
        dna = self.to_dna()
        frame_codes = [part["type"] for part in dna["frame"]]
        pt_codes = [part["type"] for part in dna["powertrain"]]
        pairs = list(zip(frame_codes, pt_codes))
        i = 0
        while i < len(pairs):
            r = random.random()
            if r < replace_p:
                pairs[i] = (random.choice(["R", "W"]), random.choice(["C", "D", "G"]))
                i += 1
            elif r < replace_p + remove_p and len(pairs) > 1:
                pairs.pop(i)
            elif r < replace_p + remove_p + insert_p:
                pairs.insert(
                    i, (random.choice(["R", "W"]), random.choice(["C", "D", "G"]))
                )
                i += 1
            else:
                i += 1
        new_frame, new_pt = zip(*pairs) if pairs else ([], [])
        return Car({"frame": list(new_frame), "powertrain": list(new_pt)})

    @staticmethod
    def reproduce(car1, car2):
        """Produce a child Car by combining two parents' DNA and mutating."""
        mother = random.choice([car1, car2])
        other = car1 if mother == car2 else car2
        child = copy.deepcopy(mother)
        for idx in range(len(child.frame)):
            if random.random() < 0.5:
                for j in range(Car.SEQUENCE_LENGTH):
                    if idx + j < len(child.frame) and idx + j < len(other.frame):
                        child.frame[idx + j] = other.frame[idx + j]
            if random.random() < 0.5:
                for j in range(Car.SEQUENCE_LENGTH):
                    if idx + j < len(child.powertrain) and idx + j < len(other.powertrain):
                        child.powertrain[idx + j] = other.powertrain[idx + j]
        return child.mutate()
