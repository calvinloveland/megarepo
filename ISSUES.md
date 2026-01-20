# Issues

Date: 2026-01-18

## Complexity (Lizard > 10)

- active/dev-tools/bingo-probability: [src/bingo_probability/cli.py](active/dev-tools/bingo-probability/src/bingo_probability/cli.py#L16) — `main(...)` CCN 11
- active/dev-tools/browser-error-logger: [src/index.ts](active/dev-tools/browser-error-logger/src/index.ts#L272) — `handleWindowError(...)` CCN 13
- active/dev-tools/hivemind-llm/frontend: [src/inference/webgpu.ts](active/dev-tools/hivemind-llm/frontend/src/inference/webgpu.ts#L82) — `estimateVRAM(...)` CCN 37
- active/dev-tools/hivemind-llm/frontend: [src/App.tsx](active/dev-tools/hivemind-llm/frontend/src/App.tsx#L59) — `(anonymous)(...)` CCN 21
- active/dev-tools/hivemind-llm/frontend: [src/inference/webgpu.ts](active/dev-tools/hivemind-llm/frontend/src/inference/webgpu.ts#L17) — `detectWebGPU(...)` CCN 12
- active/games/MancalaAI: [gym_mancala/envs/board.py](active/games/MancalaAI/gym_mancala/envs/board.py#L24) — `execute_turn(...)` CCN 14
- active/games/conway_game_of_war: [src/conways_game_of_war/game_state.py](active/games/conway_game_of_war/src/conways_game_of_war/game_state.py#L253) — `_compute_cell_update(...)` CCN 16
- active/games/conway_game_of_war: [src/conways_game_of_war/game_state.py](active/games/conway_game_of_war/src/conways_game_of_war/game_state.py#L57) — `make_move(...)` CCN 14
- active/games/conway_game_of_war: [src/conways_game_of_war/main.py](active/games/conway_game_of_war/src/conways_game_of_war/main.py#L125) — `update_cell(...)` CCN 13
- active/games/conway_game_of_war: [src/conways_game_of_war/game_state.py](active/games/conway_game_of_war/src/conways_game_of_war/game_state.py#L429) — `board_to_html(...)` CCN 12
- active/games/conway_game_of_war: [src/conways_game_of_war/game_state.py](active/games/conway_game_of_war/src/conways_game_of_war/game_state.py#L155) — `update_ownership_around_cell(...)` CCN 11
- active/games/conway_game_of_war: [src/conways_game_of_war/game_state.py](active/games/conway_game_of_war/src/conways_game_of_war/game_state.py#L228) — `_compute_new_owner(...)` CCN 11
- active/games/conway_game_of_war: [src/conways_game_of_war/game_state.py](active/games/conway_game_of_war/src/conways_game_of_war/game_state.py#L312) — `update_cell(...)` CCN 11
- active/games/conway_game_of_war: [src/conways_game_of_war/game_state.py](active/games/conway_game_of_war/src/conways_game_of_war/game_state.py#L374) — `update(...)` CCN 11
- active/games/lets-holdem-together: [holdem_together/engine.py](active/games/lets-holdem-together/holdem_together/engine.py#L82) — `simulate_hand(...)` CCN 59
- active/games/lets-holdem-together: [holdem_together/engine.py](active/games/lets-holdem-together/holdem_together/engine.py#L189) — `simulate_hand.betting_round(...)` CCN 45
- active/games/lets-holdem-together: [holdem_together/routes.py](active/games/lets-holdem-together/holdem_together/routes.py#L389) — `live_stream.generate(...)` CCN 38
- active/games/lets-holdem-together: [holdem_together/poker_eval.py](active/games/lets-holdem-together/holdem_together/poker_eval.py#L71) — `_rank_5_cached(...)` CCN 29
- active/games/lets-holdem-together: [holdem_together/routes.py](active/games/lets-holdem-together/holdem_together/routes.py#L138) — `bot_detail(...)` CCN 29
- active/games/lets-holdem-together: [holdem_together/background_runner.py](active/games/lets-holdem-together/holdem_together/background_runner.py#L39) — `run_one_match(...)` CCN 20
- active/games/lets-holdem-together: [holdem_together/routes.py](active/games/lets-holdem-together/holdem_together/routes.py#L636) — `feedback(...)` CCN 12
- active/games/lets-holdem-together: [holdem_together/game_state.py](active/games/lets-holdem-together/holdem_together/game_state.py#L59) — `_equity_cached(...)` CCN 11
- active/games/vroomon: [src/vroomon/simulation.py](active/games/vroomon/src/vroomon/simulation.py#L20) — `score_car(...)` CCN 26
- active/games/vroomon: [src/vroomon/simulation.py](active/games/vroomon/src/vroomon/simulation.py#L105) — `score_population(...)` CCN 21
- active/games/vroomon: [tests/test_reproduce_nan_issue.py](active/games/vroomon/tests/test_reproduce_nan_issue.py#L15) — `test_reproduce_main_simulation_issue(...)` CCN 16
- active/games/vroomon: [tests/test_coordinate_nan_tracking.py](active/games/vroomon/tests/test_coordinate_nan_tracking.py#L232) — `_check_all_coordinates(...)` CCN 14
- active/games/vroomon: [tests/test_pygame_nan_coordinates.py](active/games/vroomon/tests/test_pygame_nan_coordinates.py#L25) — `test_coordinate_validation_during_simulation(...)` CCN 14
- active/games/vroomon: [tests/test_nan_physics_issue.py](active/games/vroomon/tests/test_nan_physics_issue.py#L208) — `_check_car_for_nan(...)` CCN 13
- active/games/vroomon: [tests/test_motor_configuration_bug.py](active/games/vroomon/tests/test_motor_configuration_bug.py#L110) — `test_zero_power_wheel_creation(...)` CCN 13
- active/games/vroomon: [src/vroomon/population/population.py](active/games/vroomon/src/vroomon/population/population.py#L42) — `reproduce(...)` CCN 12
- active/games/vroomon: [src/vroomon/car/car.py](active/games/vroomon/src/vroomon/car/car.py#L287) — `reproduce(...)` CCN 11
