from __future__ import annotations

import ast
from dataclasses import dataclass
from functools import lru_cache
from textwrap import dedent

ALLOWED_EVENTS = {"round_start", "combat", "attack_base", "base_attacked"}
ALLOWED_API_METHODS = {
    "heal_self",
    "heal_ally",
    "heal_base",
    "gain_card_points",
    "add_attack",
    "add_attack_if_enemy_name_equals",
    "add_attack_if_enemy_name_even_length",
    "add_attack_if_enemy_name_is_palindrome",
    "add_attack_per_allies_on_board",
    "add_attack_per_round_tier",
    "add_attack_per_enemy_name_char",
    "add_base_damage",
    "add_base_damage_per_enemy_name_char",
    "reduce_incoming_damage",
    "reflect_damage",
    "reflect_damage_per_enemies_on_board",
    "reflect_damage_per_enemy_name_char",
    "log",
}
EVENT_ALLOWED_METHODS = {
    "round_start": {"heal_self", "heal_ally", "heal_base", "gain_card_points", "log"},
    "combat": {
        "heal_self",
        "add_attack",
        "add_attack_if_enemy_name_equals",
        "add_attack_if_enemy_name_even_length",
        "add_attack_if_enemy_name_is_palindrome",
        "add_attack_per_allies_on_board",
        "add_attack_per_round_tier",
        "add_attack_per_enemy_name_char",
        "reduce_incoming_damage",
        "reflect_damage",
        "reflect_damage_per_enemies_on_board",
        "reflect_damage_per_enemy_name_char",
        "log",
    },
    "attack_base": {
        "add_attack",
        "add_attack_if_enemy_name_equals",
        "add_attack_if_enemy_name_even_length",
        "add_attack_if_enemy_name_is_palindrome",
        "add_attack_per_allies_on_board",
        "add_attack_per_round_tier",
        "add_attack_per_enemy_name_char",
        "add_base_damage",
        "add_base_damage_per_enemy_name_char",
        "log",
    },
    "base_attacked": {
        "heal_base",
        "heal_ally",
        "gain_card_points",
        "add_attack",
        "add_attack_if_enemy_name_equals",
        "add_attack_if_enemy_name_even_length",
        "add_attack_if_enemy_name_is_palindrome",
        "add_attack_per_allies_on_board",
        "add_attack_per_round_tier",
        "add_attack_per_enemy_name_char",
        "reduce_incoming_damage",
        "reflect_damage",
        "reflect_damage_per_enemies_on_board",
        "reflect_damage_per_enemy_name_char",
        "log",
    },
}
ABILITY_METHOD_WEIGHTS = {
    "heal_self": 2,
    "heal_ally": 3,
    "heal_base": 3,
    "gain_card_points": 3,
    "add_attack": 3,
    "add_attack_if_enemy_name_equals": 4,
    "add_attack_if_enemy_name_even_length": 3,
    "add_attack_if_enemy_name_is_palindrome": 4,
    "add_attack_per_allies_on_board": 4,
    "add_attack_per_round_tier": 4,
    "add_attack_per_enemy_name_char": 4,
    "add_base_damage": 3,
    "add_base_damage_per_enemy_name_char": 4,
    "reduce_incoming_damage": 3,
    "reflect_damage": 3,
    "reflect_damage_per_enemies_on_board": 4,
    "reflect_damage_per_enemy_name_char": 4,
    "log": 0,
}


class AbilityScriptError(ValueError):
    pass


@dataclass(frozen=True)
class CompiledAbilityScript:
    source: str
    code: object | None
    methods: tuple[str, ...]


def _normalize_source(script: str) -> str:
    return dedent(script).strip()


def _validate_literal_int(node: ast.AST) -> None:
    if not isinstance(node, ast.Constant) or not isinstance(node.value, int) or node.value < 0:
        raise AbilityScriptError("Ability script numeric arguments must be non-negative integers.")


def _validate_literal_str(node: ast.AST) -> None:
    if not isinstance(node, ast.Constant) or not isinstance(node.value, str):
        raise AbilityScriptError("Ability script string arguments must be literal strings.")


def _validate_literal_char(node: ast.AST) -> None:
    _validate_literal_str(node)
    value = node.value
    if len(value) != 1 or value.isspace():
        raise AbilityScriptError("Name-aware ability helpers require a single non-space character.")


def _validate_call(node: ast.Call, methods: list[str], current_event: str | None) -> None:
    if node.keywords:
        raise AbilityScriptError("Ability scripts cannot use keyword arguments.")
    if not isinstance(node.func, ast.Attribute) or not isinstance(node.func.value, ast.Name) or node.func.value.id != "api":
        raise AbilityScriptError("Ability scripts may only call api methods.")
    method = node.func.attr
    if method not in ALLOWED_API_METHODS:
        raise AbilityScriptError(f"Ability method {method!r} is not allowed.")
    if current_event is None:
        raise AbilityScriptError("Ability scripts may only call api methods inside an event branch.")
    if method not in EVENT_ALLOWED_METHODS[current_event]:
        raise AbilityScriptError(f"api.{method} is not allowed during {current_event}.")
    if method == "log":
        if len(node.args) != 1:
            raise AbilityScriptError("api.log requires exactly one argument.")
        _validate_literal_str(node.args[0])
    elif method in {
        "add_attack_if_enemy_name_equals",
        "add_attack_per_enemy_name_char",
        "add_base_damage_per_enemy_name_char",
        "reflect_damage_per_enemy_name_char",
    }:
        if len(node.args) != 1:
            raise AbilityScriptError(f"api.{method} requires exactly one argument.")
        if method == "add_attack_if_enemy_name_equals":
            _validate_literal_str(node.args[0])
        else:
            _validate_literal_char(node.args[0])
    elif method in {
        "add_attack_if_enemy_name_even_length",
        "add_attack_if_enemy_name_is_palindrome",
        "add_attack_per_allies_on_board",
        "reflect_damage_per_enemies_on_board",
    }:
        if node.args:
            raise AbilityScriptError(f"api.{method} does not take arguments.")
    elif method in {"add_attack_per_round_tier"}:
        if len(node.args) != 1:
            raise AbilityScriptError(f"api.{method} requires exactly one argument.")
        _validate_literal_int(node.args[0])
    else:
        if len(node.args) != 1:
            raise AbilityScriptError(f"api.{method} requires exactly one argument.")
        _validate_literal_int(node.args[0])
    methods.append(method)


def _validate_compare(node: ast.Compare) -> None:
    if not isinstance(node, ast.Compare):
        raise AbilityScriptError("Ability scripts may only compare api.event with ==.")
    if len(node.ops) != 1 or len(node.comparators) != 1 or not isinstance(node.ops[0], ast.Eq):
        raise AbilityScriptError("Ability scripts may only compare api.event with ==.")
    left = node.left
    right = node.comparators[0]
    if not isinstance(left, ast.Attribute) or not isinstance(left.value, ast.Name) or left.value.id != "api" or left.attr != "event":
        raise AbilityScriptError("Ability scripts may only branch on api.event.")
    if not isinstance(right, ast.Constant) or not isinstance(right.value, str) or right.value not in ALLOWED_EVENTS:
        raise AbilityScriptError("Ability scripts must compare against a supported event name.")


def _validate_stmt(node: ast.stmt, methods: list[str], current_event: str | None = None) -> None:
    if isinstance(node, ast.If):
        if current_event is not None:
            raise AbilityScriptError("Ability scripts cannot nest event branches.")
        _validate_compare(node.test)
        event_name = node.test.comparators[0].value
        for child in node.body:
            _validate_stmt(child, methods, event_name)
        for child in node.orelse:
            _validate_stmt(child, methods, current_event)
        return
    if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
        _validate_call(node.value, methods, current_event)
        return
    if isinstance(node, ast.Pass):
        return
    raise AbilityScriptError("Ability scripts only support event checks and api method calls.")


@lru_cache(maxsize=512)
def compile_ability_script(script: str) -> CompiledAbilityScript:
    source = _normalize_source(script)
    if not source:
        return CompiledAbilityScript(source="", code=None, methods=())
    try:
        tree = ast.parse(source, mode="exec")
    except SyntaxError as exc:
        raise AbilityScriptError("Ability script is not valid Python.") from exc
    methods: list[str] = []
    for stmt in tree.body:
        _validate_stmt(stmt, methods)
    code = compile(tree, "<sutcg-ability>", "exec")
    return CompiledAbilityScript(source=source, code=code, methods=tuple(methods))


def normalize_ability_script(script: str) -> str:
    return compile_ability_script(script).source


def scripted_ability_weight(script: str) -> int:
    compiled = compile_ability_script(script)
    return sum(ABILITY_METHOD_WEIGHTS.get(method, 0) for method in compiled.methods)


def execute_ability_script(script: str, api: object) -> None:
    compiled = compile_ability_script(script)
    if compiled.code is None:
        return
    exec(compiled.code, {"__builtins__": {}, "api": api}, {})
