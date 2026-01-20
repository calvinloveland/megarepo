from __future__ import annotations

from wizard_fight.engine import GameConfig, apply_spell, build_initial_state, simulate, step


def _config() -> GameConfig:
    return GameConfig(
        tick_rate_hz=30,
        cast_time_seconds=0.6,
        research_delay_seconds=8.0,
        mana_regen_per_second=5.0,
        starting_mana=50,
        starting_health=120,
        arena_length=60.0,
        collision_distance=1.0,
    )


def _monkey_spell() -> dict:
    return {
        "mana_cost": 10,
        "spawn_units": [
            {
                "type": "flying_monkey",
                "hp": 20,
                "speed": 6.0,
                "damage": 5.0,
                "target": "wizard",
            }
        ],
    }


def test_deterministic_simulation_same_seed() -> None:
    config = _config()
    state_a = build_initial_state(seed=123, config=config)
    state_b = build_initial_state(seed=123, config=config)
    apply_spell(state_a, 0, _monkey_spell())
    apply_spell(state_b, 0, _monkey_spell())
    simulate(state_a, total_seconds=6.0)
    simulate(state_b, total_seconds=6.0)
    assert state_a.wizards[1].health == state_b.wizards[1].health
    assert len(state_a.units) == len(state_b.units)


def test_unit_reaches_enemy_wizard() -> None:
    config = _config()
    state = build_initial_state(seed=0, config=config)
    apply_spell(state, 0, _monkey_spell())
    simulate(state, total_seconds=15.0)
    assert state.wizards[1].health < config.starting_health


def test_units_collide_and_take_damage() -> None:
    config = _config()
    state = build_initial_state(seed=0, config=config)
    spell = _monkey_spell()
    apply_spell(state, 0, spell)
    apply_spell(state, 1, spell)
    initial_hp = {unit.unit_id: unit.hp for unit in state.units}
    for _ in range(200):
        step(state)
        if not state.units:
            break
    if state.units:
        assert any(unit.hp < initial_hp[unit.unit_id] for unit in state.units)


def test_environment_effects_expire() -> None:
    config = _config()
    state = build_initial_state(seed=0, config=config)
    fog_spell = {
        "mana_cost": 5,
        "effects": [
            {
                "type": "fog",
                "magnitude": 2.0,
                "duration": 0.5,
                "target": "area",
            }
        ],
    }
    apply_spell(state, 0, fog_spell)
    assert state.environment
    step(state, steps=60)
    assert state.environment == []
