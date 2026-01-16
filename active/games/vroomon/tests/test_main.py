"""Test cases for main module functions."""

import pytest
from unittest.mock import patch, MagicMock

from vroomon.main import test_car, main


def test_test_car_function():
    """Test the test_car function from main module."""
    # Mock the dependencies to avoid actual simulation
    with patch('vroomon.main.Car') as mock_car_class:
        with patch('vroomon.main.Ground') as mock_ground_class:
            with patch('vroomon.main.Simulation') as mock_sim_class:
                
                # Set up mocks
                mock_car = MagicMock()
                mock_car_class.return_value = mock_car
                
                mock_ground = MagicMock()
                mock_ground_class.return_value = mock_ground
                
                mock_sim = MagicMock()
                mock_sim.score_car.return_value = 10.5  # Positive score
                mock_sim_class.return_value = mock_sim
                
                # Call the function
                test_car()
                
                # Verify the function calls
                mock_car_class.assert_called_once()
                mock_ground_class.assert_called_once()
                mock_sim_class.assert_called_once()
                mock_sim.score_car.assert_called_once_with(
                    car=mock_car, 
                    ground=mock_ground, 
                    visualize=True
                )


def test_test_car_function_with_zero_score():
    """Test test_car function when car gets zero score (should raise assertion)."""
    with patch('vroomon.main.Car') as mock_car_class:
        with patch('vroomon.main.Ground') as mock_ground_class:
            with patch('vroomon.main.Simulation') as mock_sim_class:
                
                # Set up mocks with zero score
                mock_car = MagicMock()
                mock_car_class.return_value = mock_car
                
                mock_ground = MagicMock()
                mock_ground_class.return_value = mock_ground
                
                mock_sim = MagicMock()
                mock_sim.score_car.return_value = 0  # Zero score should trigger assertion
                mock_sim_class.return_value = mock_sim
                
                # Should raise AssertionError
                with pytest.raises(AssertionError, match="Car should have a positive score"):
                    test_car()


def test_main_function():
    """Test the main function."""
    # Mock the population functions
    with patch('vroomon.main.initialize_population') as mock_init_pop:
        with patch('vroomon.main.evolve_population') as mock_evolve_pop:
            with patch('vroomon.main.score_population') as mock_score_pop:
                with patch('vroomon.main.Ground') as mock_ground_class:
                    with patch('vroomon.main.Simulation') as mock_sim_class:
                        
                        # Set up population mocks
                        mock_population = [MagicMock(), MagicMock()]
                        mock_init_pop.return_value = mock_population
                        mock_evolve_pop.return_value = mock_population
                        
                        # Set up scoring mock
                        mock_best_car = MagicMock()
                        mock_score_pop.return_value = [(mock_best_car, 15.0), (MagicMock(), 10.0)]
                        
                        # Set up ground and simulation mocks
                        mock_ground = MagicMock()
                        mock_ground_class.return_value = mock_ground
                        
                        mock_sim = MagicMock()
                        mock_sim.score_car.return_value = 20.0
                        mock_sim_class.return_value = mock_sim
                        
                        # Call main function
                        main()
                        
                        # Verify the function calls
                        mock_init_pop.assert_called_once_with(20, 5)  # population_size=20, dna_length=5
                        mock_ground_class.assert_called()
                        
                        # Should call evolve_population for each generation
                        assert mock_evolve_pop.call_count == 10  # 10 generations
                        
                        # Should create final simulation for best car
                        mock_sim.score_car.assert_called_with(mock_best_car, mock_ground, visualize=True)


def test_main_function_with_visualization():
    """Test main function with generation visualization enabled."""
    with patch('vroomon.main.initialize_population') as mock_init_pop:
        with patch('vroomon.main.evolve_population') as mock_evolve_pop:
            with patch('vroomon.main.score_population') as mock_score_pop:
                with patch('vroomon.main.Ground') as mock_ground_class:
                    with patch('vroomon.main.Simulation') as mock_sim_class:
                        
                        # Set up mocks
                        mock_population = [MagicMock()]
                        mock_init_pop.return_value = mock_population
                        mock_evolve_pop.return_value = mock_population
                        
                        mock_best_car = MagicMock()
                        mock_score_pop.return_value = [(mock_best_car, 25.0)]
                        
                        mock_ground = MagicMock()
                        mock_ground_class.return_value = mock_ground
                        
                        mock_sim = MagicMock()
                        mock_sim.score_car.return_value = 25.0
                        mock_sim_class.return_value = mock_sim
                        
                        # Call main with visualization enabled
                        main(visualize_generations=True)
                        
                        # Should create multiple simulations (one per generation + final)
                        # 10 generations + 1 final = 11 simulations minimum
                        assert mock_sim_class.call_count >= 11
                        
                        # Should call score_car multiple times (generation vis + final)
                        assert mock_sim.score_car.call_count >= 11


def test_main_function_no_visualization():
    """Test main function with generation visualization disabled."""
    with patch('vroomon.main.initialize_population') as mock_init_pop:
        with patch('vroomon.main.evolve_population') as mock_evolve_pop:
            with patch('vroomon.main.score_population') as mock_score_pop:
                with patch('vroomon.main.Ground') as mock_ground_class:
                    with patch('vroomon.main.Simulation') as mock_sim_class:
                        
                        # Set up mocks
                        mock_population = [MagicMock()]
                        mock_init_pop.return_value = mock_population
                        mock_evolve_pop.return_value = mock_population
                        
                        mock_best_car = MagicMock()
                        mock_score_pop.return_value = [(mock_best_car, 15.0)]
                        
                        mock_ground = MagicMock()
                        mock_ground_class.return_value = mock_ground
                        
                        mock_sim = MagicMock()
                        mock_sim.score_car.return_value = 15.0
                        mock_sim_class.return_value = mock_sim
                        
                        # Call main with visualization disabled
                        main(visualize_generations=False)
                        
                        # Should create fewer simulations (10 for evolve + 1 final)
                        # Each generation needs one simulation for evolve_population
                        assert mock_sim_class.call_count >= 10
                        
                        # Final score_car call should happen once for final visualization
                        mock_sim.score_car.assert_called_with(mock_best_car, mock_ground, visualize=True)


def test_main_module_constants():
    """Test main module has expected constants."""
    from vroomon.main import CAR_DNA
    
    assert isinstance(CAR_DNA, dict)
    assert "powertrain" in CAR_DNA
    assert "frame" in CAR_DNA
    assert len(CAR_DNA["powertrain"]) > 0
    assert len(CAR_DNA["frame"]) > 0


def test_main_module_execution():
    """Test main module execution structure."""
    # Test that the main module has the expected functions
    from vroomon import main as main_module
    
    assert callable(main_module.main)
    assert callable(main_module.test_car)
    assert hasattr(main_module, 'CAR_DNA')