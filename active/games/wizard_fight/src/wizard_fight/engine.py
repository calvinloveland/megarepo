from __future__ import annotations

from dataclasses import dataclass, field
import json
from pathlib import Path
import random
from typing import Any, Dict, Iterable, List

_CONFIG_PATH = Path(__file__).resolve().parents[2] / "docs" / "timing_v1.json"


@dataclass
class GameConfig:
    tick_rate_hz: int
    cast_time_seconds: float
    research_delay_seconds: float
    mana_regen_per_second: float
    starting_mana: int
    starting_health: int
    arena_length: float = 100.0
    collision_distance: float = 1.0

    @property
    def dt(self) -> float:
        return 1.0 / self.tick_rate_hz


@dataclass
class Wizard:
    wizard_id: int
    health: float
    mana: float


@dataclass
class Unit:
    unit_id: int
    owner_id: int
    position: float
    hp: float
    speed: float
    damage: float
    target: str


@dataclass
class GameState:
    config: GameConfig
    wizards: Dict[int, Wizard]
    units: List[Unit] = field(default_factory=list)
    time_seconds: float = 0.0
    rng: random.Random = field(default_factory=random.Random)
    next_unit_id: int = 1
    environment: List["EnvironmentEffect"] = field(default_factory=list)


@dataclass
class EnvironmentEffect:
    effect_type: str
    magnitude: float
    remaining_duration: float


def load_config(path: Path | None = None) -> GameConfig:
    config_path = path or _CONFIG_PATH
    payload = json.loads(config_path.read_text(encoding="utf-8"))
    return GameConfig(**payload)


def build_initial_state(seed: int, config: GameConfig | None = None) -> GameState:
    resolved_config = config or load_config()
    wizards = {
        0: Wizard(0, resolved_config.starting_health, resolved_config.starting_mana),
        1: Wizard(1, resolved_config.starting_health, resolved_config.starting_mana),
    }
    rng = random.Random(seed)
    return GameState(config=resolved_config, wizards=wizards, rng=rng)


def apply_spell(state: GameState, caster_id: int, spell: Dict[str, Any]) -> bool:
    mana_cost = float(spell.get("mana_cost", 0))
    caster = state.wizards[caster_id]
    if caster.mana < mana_cost:
        return False
    caster.mana -= mana_cost
    spawn_units = spell.get("spawn_units", [])
    for unit_spec in spawn_units:
        unit = Unit(
            unit_id=state.next_unit_id,
            owner_id=caster_id,
            position=_spawn_position(state, caster_id),
            hp=float(unit_spec["hp"]),
            speed=float(unit_spec["speed"]),
            damage=float(unit_spec["damage"]),
            target=str(unit_spec["target"]),
        )
        state.units.append(unit)
        state.next_unit_id += 1
    _apply_projectiles(state, caster_id, spell.get("projectiles", []))
    _apply_effects(state, caster_id, spell.get("effects", []))
    return True


def step(state: GameState, steps: int = 1) -> None:
    for _ in range(steps):
        _regen_mana(state)
        _move_units(state)
        _resolve_collisions(state)
        _tick_environment(state)
        state.time_seconds += state.config.dt


def _regen_mana(state: GameState) -> None:
    regen = state.config.mana_regen_per_second * state.config.dt
    for wizard in state.wizards.values():
        wizard.mana += regen


def _move_units(state: GameState) -> None:
    dt = state.config.dt
    arena_length = state.config.arena_length
    speed_multiplier = _environment_speed_multiplier(state)
    survivors: List[Unit] = []
    for unit in state.units:
        direction = 1.0 if unit.owner_id == 0 else -1.0
        unit.position += unit.speed * speed_multiplier * dt * direction
        if unit.owner_id == 0 and unit.position >= arena_length:
            state.wizards[1].health -= unit.damage
            continue
        if unit.owner_id == 1 and unit.position <= 0:
            state.wizards[0].health -= unit.damage
            continue
        survivors.append(unit)
    state.units = survivors


def _resolve_collisions(state: GameState) -> None:
    units = sorted(state.units, key=lambda unit: unit.unit_id)
    damage_map: Dict[int, float] = {}
    collision_distance = state.config.collision_distance
    for i, unit_a in enumerate(units):
        for unit_b in units[i + 1 :]:
            if unit_a.owner_id == unit_b.owner_id:
                continue
            if abs(unit_a.position - unit_b.position) > collision_distance:
                continue
            damage_map[unit_a.unit_id] = damage_map.get(unit_a.unit_id, 0.0) + unit_b.damage
            damage_map[unit_b.unit_id] = damage_map.get(unit_b.unit_id, 0.0) + unit_a.damage

    remaining: List[Unit] = []
    for unit in units:
        if unit.unit_id in damage_map:
            unit.hp -= damage_map[unit.unit_id]
        if unit.hp > 0:
            remaining.append(unit)
    state.units = remaining


def _spawn_position(state: GameState, caster_id: int) -> float:
    return 0.0 if caster_id == 0 else state.config.arena_length


def _apply_projectiles(state: GameState, caster_id: int, projectiles: List[Dict[str, Any]]) -> None:
    enemy_id = 1 if caster_id == 0 else 0
    for projectile in projectiles:
        if projectile.get("target") == "wizard":
            damage = float(projectile["damage"]) * _environment_projectile_multiplier(state)
            state.wizards[enemy_id].health -= damage


def _apply_effects(state: GameState, caster_id: int, effects: List[Dict[str, Any]]) -> None:
    enemy_id = 1 if caster_id == 0 else 0
    for effect in effects:
        target = effect.get("target")
        magnitude = float(effect["magnitude"])
        effect_type = effect.get("type")
        if effect_type == "shield" and target == "self":
            state.wizards[caster_id].health += magnitude
        if effect_type == "burn" and target in {"enemy", "area"}:
            state.wizards[enemy_id].health -= magnitude
        if effect_type in {"fog", "wind", "gravity"} and target == "area":
            duration = float(effect["duration"])
            state.environment.append(
                EnvironmentEffect(effect_type=effect_type, magnitude=magnitude, remaining_duration=duration)
            )


def _tick_environment(state: GameState) -> None:
    dt = state.config.dt
    remaining: List[EnvironmentEffect] = []
    for effect in state.environment:
        effect.remaining_duration -= dt
        if effect.remaining_duration > 0:
            remaining.append(effect)
    state.environment = remaining


def _environment_speed_multiplier(state: GameState) -> float:
    multiplier = 1.0
    for effect in state.environment:
        if effect.effect_type == "wind":
            multiplier *= 1.0 + 0.03 * effect.magnitude
        if effect.effect_type == "gravity":
            multiplier *= max(0.6, 1.0 - 0.03 * effect.magnitude)
    return multiplier


def _environment_projectile_multiplier(state: GameState) -> float:
    multiplier = 1.0
    for effect in state.environment:
        if effect.effect_type == "fog":
            multiplier *= max(0.7, 1.0 - 0.05 * effect.magnitude)
    return multiplier


def simulate(state: GameState, total_seconds: float) -> GameState:
    steps = int(total_seconds / state.config.dt)
    step(state, steps)
    return state


def iter_units_by_owner(state: GameState, owner_id: int) -> Iterable[Unit]:
    return (unit for unit in state.units if unit.owner_id == owner_id)
