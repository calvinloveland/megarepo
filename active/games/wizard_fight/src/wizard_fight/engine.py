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
    lane_count: int = 3
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
    lane: int
    position: float
    hp: float
    speed: float
    damage: float
    target: str
    element: str | None = None
    emoji: str | None = None
    weaknesses: tuple[str, ...] = ()
    immunities: tuple[str, ...] = ()


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
    lane_id: int | None = None
    speed_mult: float = 1.0
    damage_mult: float = 1.0


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
        lane = _resolve_lane(state, unit_spec.get("lane"))
        emoji = unit_spec.get("emoji") or spell.get("emoji")
        unit = Unit(
            unit_id=state.next_unit_id,
            owner_id=caster_id,
            lane=lane,
            position=_spawn_position(state, caster_id),
            hp=float(unit_spec["hp"]),
            speed=float(unit_spec["speed"]),
            damage=float(unit_spec["damage"]),
            target=str(unit_spec["target"]),
            element=_normalize_element(unit_spec.get("element")),
            emoji=str(emoji) if emoji else None,
            weaknesses=tuple(unit_spec.get("weaknesses", [])),
            immunities=tuple(unit_spec.get("immunities", [])),
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
    survivors: List[Unit] = []
    for unit in state.units:
        speed_multiplier = _environment_speed_multiplier(state, unit.lane)
        direction = 1.0 if unit.owner_id == 0 else -1.0
        unit.position += unit.speed * speed_multiplier * dt * direction
        if unit.owner_id == 0 and unit.position >= arena_length:
            damage_multiplier = _environment_damage_multiplier(state, unit.lane)
            state.wizards[1].health -= unit.damage * damage_multiplier
            continue
        if unit.owner_id == 1 and unit.position <= 0:
            damage_multiplier = _environment_damage_multiplier(state, unit.lane)
            state.wizards[0].health -= unit.damage * damage_multiplier
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
            if unit_a.lane != unit_b.lane:
                continue
            if abs(unit_a.position - unit_b.position) > collision_distance:
                continue
            damage_from_b = _adjust_damage(unit_b.damage, unit_b.element, unit_a)
            damage_from_a = _adjust_damage(unit_a.damage, unit_a.element, unit_b)
            damage_from_b *= _environment_damage_multiplier(state, unit_a.lane)
            damage_from_a *= _environment_damage_multiplier(state, unit_a.lane)
            damage_map[unit_a.unit_id] = damage_map.get(unit_a.unit_id, 0.0) + damage_from_b
            damage_map[unit_b.unit_id] = damage_map.get(unit_b.unit_id, 0.0) + damage_from_a

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
    middle_lane = _middle_lane(state)
    for projectile in projectiles:
        target = projectile.get("target")
        if target == "wizard":
            damage = float(projectile["damage"]) * _environment_projectile_multiplier(state, middle_lane)
            state.wizards[enemy_id].health -= damage
            continue
        damage = float(projectile["damage"]) * _environment_projectile_multiplier(state, middle_lane)
        element = _normalize_element(projectile.get("element"))
        _apply_projectile_damage_to_lane(state, middle_lane, damage, element, target)


def _apply_effects(state: GameState, caster_id: int, effects: List[Dict[str, Any]]) -> None:
    enemy_id = 1 if caster_id == 0 else 0
    middle_lane = _middle_lane(state)
    for effect in effects:
        target = effect.get("target")
        magnitude = float(effect["magnitude"])
        effect_type = effect.get("type")
        if effect_type == "shield" and target == "self":
            state.wizards[caster_id].health += magnitude
        if effect_type == "burn" and target in {"enemy", "area"}:
            state.wizards[enemy_id].health -= magnitude
        if effect_type in {"fog", "wind", "gravity", "buff", "debuff"} and target == "area":
            duration = float(effect["duration"])
            speed_mult, damage_mult = _effect_multipliers(effect_type, magnitude)
            state.environment.append(
                EnvironmentEffect(
                    effect_type=effect_type,
                    magnitude=magnitude,
                    remaining_duration=duration,
                    lane_id=middle_lane,
                    speed_mult=speed_mult,
                    damage_mult=damage_mult,
                )
            )


def _tick_environment(state: GameState) -> None:
    dt = state.config.dt
    remaining: List[EnvironmentEffect] = []
    for effect in state.environment:
        effect.remaining_duration -= dt
        if effect.remaining_duration > 0:
            remaining.append(effect)
    state.environment = remaining


def _environment_speed_multiplier(state: GameState, lane_id: int) -> float:
    multiplier = 1.0
    for effect in state.environment:
        if effect.lane_id is not None and effect.lane_id != lane_id:
            continue
        if effect.effect_type == "wind":
            multiplier *= 1.0 + 0.03 * effect.magnitude
        if effect.effect_type == "gravity":
            multiplier *= max(0.6, 1.0 - 0.03 * effect.magnitude)
        if effect.effect_type in {"buff", "debuff"}:
            multiplier *= effect.speed_mult
    return multiplier


def _environment_projectile_multiplier(state: GameState, lane_id: int) -> float:
    multiplier = 1.0
    for effect in state.environment:
        if effect.lane_id is not None and effect.lane_id != lane_id:
            continue
        if effect.effect_type == "fog":
            multiplier *= max(0.7, 1.0 - 0.05 * effect.magnitude)
    return multiplier


def _environment_damage_multiplier(state: GameState, lane_id: int) -> float:
    multiplier = 1.0
    for effect in state.environment:
        if effect.lane_id is not None and effect.lane_id != lane_id:
            continue
        if effect.effect_type in {"buff", "debuff"}:
            multiplier *= effect.damage_mult
    return multiplier


def simulate(state: GameState, total_seconds: float) -> GameState:
    steps = int(total_seconds / state.config.dt)
    step(state, steps)
    return state


def iter_units_by_owner(state: GameState, owner_id: int) -> Iterable[Unit]:
    return (unit for unit in state.units if unit.owner_id == owner_id)


def _resolve_lane(state: GameState, lane_value: Any) -> int:
    try:
        lane = int(lane_value)
        if 0 <= lane < state.config.lane_count:
            return lane
    except Exception:
        pass
    return state.rng.randrange(state.config.lane_count)


def _middle_lane(state: GameState) -> int:
    return state.config.lane_count // 2


def _normalize_element(value: Any) -> str | None:
    if not value:
        return None
    return str(value).strip().lower()


def _adjust_damage(base_damage: float, element: str | None, target: Unit) -> float:
    if not element:
        return base_damage
    if element in target.immunities:
        return 0.0
    if element in target.weaknesses:
        return base_damage * 1.5
    return base_damage


def _apply_projectile_damage_to_lane(
    state: GameState, lane_id: int, damage: float, element: str | None, target: str | None
) -> None:
    for unit in state.units:
        if unit.lane != lane_id:
            continue
        unit.hp -= _adjust_damage(damage, element, unit)


def _effect_multipliers(effect_type: str, magnitude: float) -> tuple[float, float]:
    clamped = min(5.0, max(0.0, magnitude))
    delta = min(0.5, 0.1 * clamped)
    if effect_type == "buff":
        return 1.0 + delta, 1.0 + delta
    if effect_type == "debuff":
        return max(0.5, 1.0 - delta), max(0.5, 1.0 - delta)
    return 1.0, 1.0
