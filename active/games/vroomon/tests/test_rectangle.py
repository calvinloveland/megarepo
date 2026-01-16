"""Test cases for Rectangle frame part."""

import math
import pymunk
import pytest
from unittest.mock import patch

from vroomon.car.frame.rectangle import Rectangle, create_box_with_offset


class MockPosition:
    """Mock position object for testing."""
    def __init__(self, x, y):
        self.x = x
        self.y = y


def test_create_box_with_offset():
    """Test the create_box_with_offset function."""
    body = pymunk.Body()
    size = (10, 5)
    offset = (2, 3)
    
    polygon = create_box_with_offset(body, size, offset)
    
    assert isinstance(polygon, pymunk.Poly)
    assert polygon.body == body
    # Vertices should be offset by the specified amount
    vertices = polygon.get_vertices()
    assert len(vertices) == 4


def test_rectangle_init_with_defaults():
    """Test Rectangle initialization with default dimensions."""
    body = pymunk.Body()
    pos = MockPosition(0, 0)
    
    rect = Rectangle(body, pos)
    
    assert rect.body == body
    assert rect.length > 0
    assert rect.height > 0
    assert rect.polygon is not None
    assert rect.polygon.density == 1


def test_rectangle_init_with_custom_dimensions():
    """Test Rectangle initialization with custom dimensions."""
    body = pymunk.Body()
    pos = MockPosition(0, 0)
    length = 15.0
    height = 8.0
    
    rect = Rectangle(body, pos, length, height)
    
    assert rect.length == length
    assert rect.height == height


def test_rectangle_validate_dimension_nan():
    """Test dimension validation with NaN values."""
    body = pymunk.Body()
    pos = MockPosition(0, 0)
    
    with patch('builtins.print') as mock_print:
        rect = Rectangle(body, pos, math.nan, 5.0)
        mock_print.assert_called()
        assert rect.length == 10.0  # Should use default


def test_rectangle_validate_dimension_infinite():
    """Test dimension validation with infinite values."""
    body = pymunk.Body()
    pos = MockPosition(0, 0)
    
    with patch('builtins.print') as mock_print:
        rect = Rectangle(body, pos, 10.0, math.inf)
        mock_print.assert_called()
        assert rect.height == 5.0  # Should use default


def test_rectangle_validate_dimension_zero():
    """Test dimension validation with zero values."""
    body = pymunk.Body()
    pos = MockPosition(0, 0)
    
    with patch('builtins.print') as mock_print:
        rect = Rectangle(body, pos, 0, 5.0)
        mock_print.assert_called()
        assert rect.length == 1.0  # Should use minimum


def test_rectangle_validate_dimension_negative():
    """Test dimension validation with negative values."""
    body = pymunk.Body()
    pos = MockPosition(0, 0)
    
    with patch('builtins.print') as mock_print:
        rect = Rectangle(body, pos, -5.0, 5.0)
        mock_print.assert_called()
        assert rect.length == 1.0  # Should use minimum


def test_rectangle_validate_dimension_very_small():
    """Test dimension validation with very small values."""
    body = pymunk.Body()
    pos = MockPosition(0, 0)
    
    with patch('builtins.print') as mock_print:
        rect = Rectangle(body, pos, 0.1, 5.0)
        mock_print.assert_called()
        assert rect.length == 1.0  # Should use minimum


def test_rectangle_validate_dimension_very_large():
    """Test dimension validation with very large values."""
    body = pymunk.Body()
    pos = MockPosition(0, 0)
    
    with patch('builtins.print') as mock_print:
        rect = Rectangle(body, pos, 100.0, 5.0)
        mock_print.assert_called()
        assert rect.length == 50.0  # Should clamp to maximum


def test_rectangle_validate_dimension_normal():
    """Test dimension validation with normal values."""
    body = pymunk.Body()
    pos = MockPosition(0, 0)
    
    length = 15.0
    rect = Rectangle(body, pos, length, 5.0)
    assert rect.length == length  # Should not change


def test_rectangle_mutate():
    """Test rectangle mutation."""
    body = pymunk.Body()
    pos = MockPosition(0, 0)
    
    rect = Rectangle(body, pos, 10.0, 5.0)
    original_color = rect.polygon.color
    original_length = rect.length
    original_height = rect.height
    
    rect.mutate()
    
    # Color should change
    assert rect.polygon.color != original_color
    # Dimensions may change due to random generation
    assert rect.length > 0
    assert rect.height > 0


def test_rectangle_from_random():
    """Test creating rectangle from random factory method."""
    body = pymunk.Body()
    pos = MockPosition(0, 0)
    
    rect = Rectangle.from_random(body, pos)
    
    assert rect.body == body
    assert rect.length > 0
    assert rect.height > 0


def test_rectangle_to_dna():
    """Test converting rectangle to DNA format."""
    body = pymunk.Body()
    pos = MockPosition(0, 0)
    length = 12.0
    height = 6.0
    
    rect = Rectangle(body, pos, length, height)
    dna = rect.to_dna()
    
    assert dna["type"] == "R"
    assert dna["length"] == length
    assert dna["height"] == height


def test_rectangle_from_dna_with_dimensions():
    """Test creating rectangle from DNA with dimensions."""
    body = pymunk.Body()
    pos = MockPosition(0, 0)
    dna = {
        "type": "R",
        "length": 15.0,
        "height": 8.0
    }
    
    rect = Rectangle.from_dna(body, pos, dna)
    
    assert rect.length == 15.0
    assert rect.height == 8.0


def test_rectangle_from_dna_none():
    """Test creating rectangle from DNA with None (fallback case)."""
    body = pymunk.Body()
    pos = MockPosition(0, 0)
    
    rect = Rectangle.from_dna(body, pos, None)
    
    assert rect.length > 0
    assert rect.height > 0


def test_rectangle_from_dna_missing_dimensions():
    """Test creating rectangle from DNA with missing dimensions."""
    body = pymunk.Body()
    pos = MockPosition(0, 0)
    dna = {"type": "R"}  # Missing length and height
    
    rect = Rectangle.from_dna(body, pos, dna)
    
    # Should use generated dimensions since length/height are None
    assert rect.length > 0
    assert rect.height > 0