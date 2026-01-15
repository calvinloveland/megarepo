"""Tests for time_function_with_timeout module."""

import time

from time_function_with_timeout import time_function_with_timeout


def test_half_second_function():
    """Test timing a function that takes about half a second."""
    def half_second_function():
        time.sleep(0.5)

    elapsed, _ = time_function_with_timeout(half_second_function, timeout=0.6)
    assert 0.49 < elapsed < 0.51


def test_function_returns():
    """Test that return values are properly captured."""
    def function_returns():
        return 1

    elapsed, value = time_function_with_timeout(function_returns, timeout=0.5)
    assert elapsed < 0.01
    assert value == 1


def test_function_with_args():
    """Test passing positional arguments to the function."""
    def function_with_args(a, b):
        return a + b

    elapsed, value = time_function_with_timeout(function_with_args, 1, 2, timeout=0.5)
    assert elapsed < 0.01
    assert value == 3


def test_function_with_kwargs():
    """Test passing keyword arguments to the function."""
    def function_with_kwargs(a, b):
        return a + b

    elapsed, value = time_function_with_timeout(
        function_with_kwargs, timeout=0.5, a=1, b=2
    )
    assert elapsed < 0.01
    assert value == 3


def test_function_timeout():
    """Test that TimeoutError is raised when function exceeds timeout."""
    def function_timeout():
        time.sleep(1)

    try:
        time_function_with_timeout(function_timeout, timeout=0.5)
    except TimeoutError:
        assert True
    else:
        assert False
