"""Test cases for Simulation module."""

import pytest
from unittest.mock import patch, MagicMock
import pymunk

from vroomon.simulation import Simulation
from vroomon.car.car import Car
from vroomon.ground import Ground


def test_simulation_init():
    """Test Simulation initialization."""
    sim = Simulation()
    
    assert isinstance(sim.space, pymunk.Space)
    assert sim.space.gravity == (0, 9.8)


def test_score_car_minimal_car():
    """Test scoring a car with minimal valid frame/powertrain."""
    sim = Simulation()
    ground = Ground()
    
    # Create car with minimal valid DNA (at least one frame part)
    minimal_dna = {"frame": ["R"], "powertrain": ["C"]}
    minimal_car = Car(minimal_dna)
    
    score = sim.score_car(minimal_car, ground, visualize=False)
    assert isinstance(score, (int, float))
    assert score >= 0


def test_score_car_normal():
    """Test scoring a normal car."""
    sim = Simulation()
    ground = Ground()
    
    # Create car with valid DNA
    car_dna = {
        "frame": ["R", "W"],
        "powertrain": ["C", "D"]
    }
    car = Car(car_dna)
    
    score = sim.score_car(car, ground, visualize=False)
    assert isinstance(score, (int, float))
    assert score >= 0  # Should be non-negative


def test_score_car_with_visualization_check():
    """Test car scoring with visualization check."""
    sim = Simulation()
    ground = Ground()
    
    car_dna = {
        "frame": ["R", "W"],
        "powertrain": ["C", "D"]
    }
    car = Car(car_dna)
    
    # Test that visualization works or fails gracefully
    with patch('vroomon.simulation.pygame') as mock_pygame:
        # Mock pygame.init to check if it's called
        mock_pygame.init = MagicMock()
        mock_pygame.display.set_mode = MagicMock(return_value=MagicMock())
        mock_pygame.time.Clock = MagicMock(return_value=MagicMock())
        mock_pygame.event.get = MagicMock(return_value=[])
        
        score = sim.score_car(car, ground, visualize=True)
        assert isinstance(score, (int, float))
        # pygame.init should have been called when visualize=True
        mock_pygame.init.assert_called_once()


def test_score_car_without_pygame():
    """Test car scoring handles missing pygame gracefully."""
    sim = Simulation()
    ground = Ground()
    
    car_dna = {
        "frame": ["R", "W"],
        "powertrain": ["C", "D"]
    }
    car = Car(car_dna)
    
    # Test with actual None pygame (simulating import failure)
    with patch('vroomon.simulation.pygame', None):
        # This should raise AttributeError when trying to call pygame.init()
        with pytest.raises(AttributeError):
            sim.score_car(car, ground, visualize=True)


def test_score_car_nan_detection():
    """Test NaN detection in simulation."""
    sim = Simulation()
    ground = Ground()
    
    car_dna = {
        "frame": ["R", "W"],
        "powertrain": ["C", "D"]
    }
    car = Car(car_dna)
    
    # Mock math.isnan to always return True (simulating NaN detection)
    with patch('vroomon.simulation.math.isnan', return_value=True):
        with patch('vroomon.simulation.logger') as mock_logger:
            score = sim.score_car(car, ground, visualize=True)
            # Should complete without error despite NaN
            assert isinstance(score, (int, float))


def test_score_population_empty():
    """Test scoring empty population."""
    sim = Simulation()
    ground = Ground()
    
    results = sim.score_population([], ground, visualize=False)
    assert results == []


def test_score_population_normal():
    """Test scoring population with multiple cars."""
    sim = Simulation()
    ground = Ground()
    
    # Create multiple cars
    cars = []
    for i in range(3):
        car_dna = {
            "frame": ["R", "W"],
            "powertrain": ["C", "D"]
        }
        cars.append(Car(car_dna))
    
    results = sim.score_population(cars, ground, visualize=False)
    
    assert len(results) == 3
    for car, score in results:
        assert isinstance(car, Car)
        assert isinstance(score, (int, float))
        assert score >= 0


def test_score_population_with_visualization():
    """Test population scoring with visualization enabled."""
    sim = Simulation()
    ground = Ground()
    
    car_dna = {
        "frame": ["R", "W"],
        "powertrain": ["C", "D"]
    }
    car = Car(car_dna)
    
    # Mock pygame components for visualization
    with patch('vroomon.simulation.pygame') as mock_pygame:
        mock_pygame.init.return_value = None
        mock_pygame.display.set_mode.return_value = MagicMock()
        mock_pygame.time.Clock.return_value = MagicMock()
        mock_pygame.event.get.return_value = []
        mock_pygame.QUIT = 256  # Mock pygame constant
        
        # Mock DrawOptions
        with patch('vroomon.simulation.pymunk.pygame_util.DrawOptions') as mock_draw_options:
            mock_draw_options.return_value = MagicMock()
            
            results = sim.score_population([car], ground, visualize=True)
            
            assert len(results) == 1
            assert isinstance(results[0][0], Car)
            assert isinstance(results[0][1], (int, float))


def test_score_population_with_quit_event():
    """Test population scoring when pygame QUIT event is triggered."""
    sim = Simulation()
    ground = Ground()
    
    car_dna = {
        "frame": ["R", "W"],
        "powertrain": ["C", "D"]
    }
    car = Car(car_dna)
    
    # Mock pygame with quit event
    with patch('vroomon.simulation.pygame') as mock_pygame:
        mock_pygame.init.return_value = None
        mock_pygame.display.set_mode.return_value = MagicMock()
        mock_pygame.time.Clock.return_value = MagicMock()
        mock_pygame.QUIT = 256
        
        # Create a mock quit event
        mock_event = MagicMock()
        mock_event.type = 256  # pygame.QUIT
        mock_pygame.event.get.return_value = [mock_event]
        
        with patch('vroomon.simulation.pymunk.pygame_util.DrawOptions'):
            results = sim.score_population([car], ground, visualize=True)
            
            # Should still return results even with quit event
            assert len(results) == 1


def test_score_population_drawing_error_handling():
    """Test population scoring with drawing error handling."""
    sim = Simulation()
    ground = Ground()
    
    car_dna = {
        "frame": ["R", "W"],
        "powertrain": ["C", "D"]
    }
    car = Car(car_dna)
    
    with patch('vroomon.simulation.pygame') as mock_pygame:
        mock_pygame.init.return_value = None
        mock_screen = MagicMock()
        mock_pygame.display.set_mode.return_value = mock_screen
        mock_pygame.time.Clock.return_value = MagicMock()
        mock_pygame.event.get.return_value = []
        
        # Make the drawing operation fail and mock the exception handling
        with patch('vroomon.simulation.pymunk.pygame_util.DrawOptions') as mock_draw_options:
            # Make debug_draw raise an exception
            mock_draw_instance = MagicMock()
            mock_draw_options.return_value = mock_draw_instance
            
            with patch.object(sim.space, 'debug_draw', side_effect=Exception("Drawing error")):
                with patch('vroomon.simulation.logger') as mock_logger:
                    results = sim.score_population([car], ground, visualize=True)
                    
                    # Should complete despite drawing error
                    assert len(results) == 1
                    # Logger should have been called with warning
                    mock_logger.warning.assert_called()


def test_simulation_car_removal():
    """Test proper car removal from simulation space."""
    sim = Simulation()
    ground = Ground()
    
    car_dna = {
        "frame": ["R", "W"],
        "powertrain": ["C", "D"]
    }
    car = Car(car_dna)
    
    # Add car to space
    car.add_to_space(sim.space)
    initial_body_count = len(sim.space.bodies)
    
    # Score the car (which should remove it)
    sim.score_car(car, ground, visualize=False)
    
    # Car should be properly removed (space might have ground bodies remaining)
    assert len(sim.space.bodies) <= initial_body_count


def test_simulation_physics_reset():
    """Test that cars have their physics reset before simulation."""
    sim = Simulation()
    ground = Ground()
    
    car_dna = {
        "frame": ["R", "W"],
        "powertrain": ["C", "D"]
    }
    car = Car(car_dna)
    
    # Mock the reset_physics method to verify it's called
    with patch.object(car, 'reset_physics') as mock_reset:
        sim.score_car(car, ground, visualize=False)
        mock_reset.assert_called_once()


def test_simulation_space_cleanup():
    """Test that simulation space is properly cleaned up."""
    sim = Simulation()
    ground = Ground()
    
    car_dna = {
        "frame": ["R", "W"],
        "powertrain": ["C", "D"]
    }
    car = Car(car_dna)
    
    # Test that cleanup doesn't raise errors even if car parts aren't in space
    with patch('vroomon.simulation.logger') as mock_logger:
        sim.score_car(car, ground, visualize=False)
        # Should not log any errors for normal operation
        mock_logger.debug.assert_not_called()


def test_simulation_error_handling():
    """Test simulation error handling during car removal."""
    sim = Simulation()
    ground = Ground()
    
    car_dna = {
        "frame": ["R", "W"],
        "powertrain": ["C", "D"]
    }
    car = Car(car_dna)
    
    # Mock space.remove to raise an exception
    with patch.object(sim.space, 'remove', side_effect=Exception("Removal error")):
        with patch('vroomon.simulation.logger') as mock_logger:
            # Should handle the error gracefully
            sim.score_car(car, ground, visualize=False)
            # Logger debug should be called for the error
            mock_logger.debug.assert_called()