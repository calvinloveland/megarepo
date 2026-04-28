import itertools
import random

from super_ultimate_trading_card_game.bots import PrototypeBot, create_default_bots
from super_ultimate_trading_card_game.engine import (
    MatchContext,
    _apply_round_income_and_healing,
    _resolve_base_attacks,
    _resolve_engagements,
    run_match,
)
from super_ultimate_trading_card_game.generation import DeterministicCardGenerator
from super_ultimate_trading_card_game.models import CardDefinition, CardInPlay, CardKind, PassiveAbility, PlayerState, TrackName
from super_ultimate_trading_card_game.storage import load_match, save_bot_collection, save_match


def test_match_completes_with_valid_result():
    generator = DeterministicCardGenerator(seed=3)
    left, right = create_default_bots(seed=3)
    result = run_match(left, right, generator, seed=3)
    assert result.rounds_played >= 1
    assert result.reason
    assert result.generated_cards >= 0


def test_playtest_sequence_keeps_generating_owned_cards():
    generator = DeterministicCardGenerator(seed=5)
    left, right = create_default_bots(seed=5)
    first = run_match(left, right, generator, seed=5)
    second = run_match(left, right, generator, seed=6)
    assert first.generated_cards >= 0
    assert second.generated_cards >= 0
    assert len(left.profile.owned_cards) >= 6
    assert len(right.profile.owned_cards) >= 6


def test_battle_log_surfaces_scripted_ability_usage():
    generator = DeterministicCardGenerator(seed=19)
    left, right = create_default_bots(seed=19)
    result = run_match(left, right, generator, seed=19)
    log_text = "\n".join(result.event_log)
    assert "used " in log_text
    assert "scripted ability" in log_text or "bonus damage" in log_text or "Generates extra card points" in log_text


def test_match_result_can_be_persisted(tmp_path):
    generator = DeterministicCardGenerator(seed=13)
    left, right = create_default_bots(seed=13)
    result = run_match(left, right, generator, seed=13)
    db_path = tmp_path / "sutcg.sqlite3"
    save_bot_collection(left, path=db_path)
    save_bot_collection(right, path=db_path)
    match_id = save_match(
        seed=13,
        generator="deterministic",
        left_player=left.player_id,
        right_player=right.player_id,
        result=result,
        path=db_path,
    )
    stored = load_match(match_id, path=db_path)
    assert stored is not None
    assert stored.rounds_played == result.rounds_played
    assert stored.event_log[0].startswith("=== Round 1 ===")


def _make_bot(player_id: str, display_name: str) -> PrototypeBot:
    return PrototypeBot(player_id, display_name, "inventor", seed=1)


def _make_base(
    owner_id: str,
    name: str,
    *,
    ability_summary: str = "No scripted ability.",
    ability_script: str = "",
) -> CardDefinition:
    return CardDefinition(
        card_id=f"base-{owner_id}",
        name=name,
        theme=name.lower(),
        prompt=name.lower(),
        owner_id=owner_id,
        kind=CardKind.BASE,
        hp=20,
        attack=0,
        cpc=None,
        speed=0,
        attack_range=0,
        income=2,
        keywords=(),
        role_tags=(),
        passive=PassiveAbility("none", 0, "No passive ability."),
        ability_summary=ability_summary,
        ability_script=ability_script,
    )


def _make_unit(
    *,
    owner_id: str,
    card_id: str,
    name: str,
    attack: int,
    hp: int,
    keywords: tuple[str, ...] = (),
    ability_summary: str = "No scripted ability.",
    ability_script: str = "",
) -> CardDefinition:
    return CardDefinition(
        card_id=card_id,
        name=name,
        theme=name.lower(),
        prompt=name.lower(),
        owner_id=owner_id,
        kind=CardKind.UNIT,
        hp=hp,
        attack=attack,
        cpc=2,
        speed=1,
        attack_range=0,
        income=0,
        keywords=keywords,
        role_tags=(),
        passive=PassiveAbility("none", 0, "No passive ability."),
        ability_summary=ability_summary,
        ability_script=ability_script,
    )


def _make_state(player_id: str, display_name: str, base_card: CardDefinition) -> PlayerState:
    return PlayerState(
        player_id=player_id,
        display_name=display_name,
        base_card=base_card,
        base_hp=base_card.hp,
        card_points=0,
        draw_pile=[],
        discard_pile=[],
        hand=[],
        owned_cards={},
        owned_bases={},
    )


def _make_context(board: list[CardInPlay], left_state: PlayerState, right_state: PlayerState) -> MatchContext:
    return MatchContext(
        left=_make_bot(left_state.player_id, left_state.display_name),
        right=_make_bot(right_state.player_id, right_state.display_name),
        left_state=left_state,
        right_state=right_state,
        board=board,
        rng=random.Random(1),
        log=[],
        instance_counter=itertools.count(10),
    )


def test_scripted_abilities_execute_for_round_start_combat_and_base_attack():
    healer = CardInPlay(
        instance_id="instance-1",
        definition=_make_unit(
            owner_id="alpha",
            card_id="alpha-healer",
            name="Repair Medic",
            attack=1,
            hp=4,
            keywords=("Healing",),
            ability_summary="Repair Pulse",
            ability_script='if api.event == "round_start":\n    api.heal_ally(2)',
        ),
        owner_id="alpha",
        track=TrackName.FAST,
        position=1.0,
        stationary=False,
        entered_round=1,
        current_hp=4,
    )
    wounded = CardInPlay(
        instance_id="instance-2",
        definition=_make_unit(owner_id="alpha", card_id="alpha-ally", name="Wounded Ally", attack=2, hp=6),
        owner_id="alpha",
        track=TrackName.FAST,
        position=2.0,
        stationary=False,
        entered_round=1,
        current_hp=3,
    )
    shield = CardInPlay(
        instance_id="instance-3",
        definition=_make_unit(
            owner_id="alpha",
            card_id="alpha-shield",
            name="Mirror Shield",
            attack=1,
            hp=6,
            keywords=("Defender",),
            ability_summary="Mirror Spines",
            ability_script='if api.event == "combat":\n    api.reflect_damage(2)\n    api.reduce_incoming_damage(1)',
        ),
        owner_id="alpha",
        track=TrackName.SLOW,
        position=5.0,
        stationary=True,
        entered_round=1,
        current_hp=6,
        engaged_with="instance-4",
    )
    raider = CardInPlay(
        instance_id="instance-4",
        definition=_make_unit(owner_id="beta", card_id="beta-raider", name="Raider", attack=3, hp=5),
        owner_id="beta",
        track=TrackName.SLOW,
        position=5.0,
        stationary=False,
        entered_round=1,
        current_hp=5,
        engaged_with="instance-3",
    )
    siege_beast = CardInPlay(
        instance_id="instance-5",
        definition=_make_unit(
            owner_id="alpha",
            card_id="alpha-siege",
            name="Siege Beast",
            attack=4,
            hp=5,
            ability_summary="Battering Run",
            ability_script='if api.event == "attack_base":\n    api.add_base_damage(2)',
        ),
        owner_id="alpha",
        track=TrackName.FAST,
        position=10.0,
        stationary=False,
        entered_round=1,
        current_hp=5,
    )

    left_state = _make_state("alpha", "Alpha", _make_base("alpha", "Alpha Base"))
    right_state = _make_state("beta", "Beta", _make_base("beta", "Beta Base"))
    context = _make_context([healer, wounded, shield, raider, siege_beast], left_state, right_state)

    _apply_round_income_and_healing(context)
    _resolve_engagements(context, round_number=2)
    _resolve_base_attacks(context, round_number=2)

    log_text = "\n".join(context.log)
    assert wounded.current_hp == 5
    assert raider.current_hp == 2
    assert right_state.base_hp == 14
    assert "Repair Medic#1 used Repair Pulse to heal Wounded Ally#2 for 2." in log_text
    assert "Mirror Shield#3 reflected 2 damage back to Raider#4." in log_text
    assert "Siege Beast#5 used Battering Run for +2 base damage." in log_text


def test_base_scripted_abilities_execute_for_round_start_and_base_attacked():
    defender_base = _make_base(
        "beta",
        "Beta Base",
        ability_summary="Garden Bulwark",
        ability_script='if api.event == "round_start":\n    api.gain_card_points(1)\nif api.event == "base_attacked":\n    api.reduce_incoming_damage(2)\n    api.reflect_damage(1)\n    api.add_attack(2)',
    )
    left_state = _make_state("alpha", "Alpha", _make_base("alpha", "Alpha Base"))
    right_state = _make_state("beta", "Beta", defender_base)
    siege_beast = CardInPlay(
        instance_id="instance-7",
        definition=_make_unit(owner_id="alpha", card_id="alpha-siege", name="Siege Beast", attack=4, hp=5),
        owner_id="alpha",
        track=TrackName.FAST,
        position=10.0,
        stationary=False,
        entered_round=1,
        current_hp=5,
    )
    context = _make_context([siege_beast], left_state, right_state)

    _apply_round_income_and_healing(context)
    _resolve_base_attacks(context, round_number=2)

    log_text = "\n".join(context.log)
    assert right_state.card_points == 3
    assert right_state.base_hp == 18
    assert siege_beast.current_hp == 2
    assert "Beta's base used Garden Bulwark to gain +1 card points." in log_text
    assert "Beta's base used Garden Bulwark to reduce incoming damage by 2." in log_text
    assert "Beta's base reflected 1 damage back to Siege Beast#7." in log_text
