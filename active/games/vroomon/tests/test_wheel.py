import unittest

import pymunk

from vroomon.car.frame.wheel import Wheel


class TestWheel(unittest.TestCase):

    def test_wheel_creation(self):
        """Test that a wheel is created with the correct properties."""
        body = pymunk.Body()
        pos = pymunk.Vec2d(0, 0)
        wheel = Wheel(body, pos, power=10, torque=5, size=15)
        self.assertEqual(wheel.power, 10)
        self.assertEqual(wheel.torque, 5)
        self.assertEqual(wheel.size, 15)

    def test_wheel_build(self):
        """Test that the wheel is built correctly."""
        body = pymunk.Body()
        pos = pymunk.Vec2d(0, 0)
        wheel = Wheel(body, pos, power=10, torque=5, size=15)
        wheel.build_wheel()

        self.assertIsNotNone(wheel.wheel_body)
        self.assertIsNotNone(wheel.circle)
        self.assertIsNotNone(wheel.pivot)
        self.assertIsNotNone(wheel.motor)

    def test_wheel_mutation(self):
        """Test that the wheel can mutate its size."""
        body = pymunk.Body()
        pos = pymunk.Vec2d(0, 0)
        wheel = Wheel(body, pos, power=10, torque=5, size=15)
        original_size = wheel.size
        wheel.mutate()
        self.assertNotEqual(wheel.size, original_size)

    def test_wheel_motor_rate(self):
        """Test that the motor rate is calculated correctly."""
        body = pymunk.Body()
        pos = pymunk.Vec2d(0, 0)
        wheel = Wheel(body, pos, power=10, torque=5, size=15)
        wheel.build_wheel()
        expected_rate = -wheel.power / wheel.size
        self.assertAlmostEqual(wheel.motor.rate, expected_rate)


if __name__ == "__main__":
    unittest.main()
