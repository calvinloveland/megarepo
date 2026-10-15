/*
 * Hold 'Em Together — Gamebase
 *
 * A complete, server-free Texas Hold'em game: vanilla JS + DOM/CSS, no build
 * step, no third-party scripts. The same file contains
 *
 *   1. HoldemEval   — a faithful 5-card / 7-card hand evaluator (ported from the
 *                     Python `poker_eval.py` of lets-holdem-together).
 *   2. HoldemEngine — an incremental betting engine (blinds, streets, raises,
 *                     all-ins, side pots, showdown) ported from `engine.py` and
 *                     `game_state.py`.
 *   3. The UI + networking. Solo runs the engine locally with bot seats filled.
 *      Online is host-authoritative peer-to-peer via `Gamebase.connectPeers`:
 *      match.players[0] runs the dealer and broadcasts public table state plus
 *      each player's own hole cards; peers only send actions.
 *
 * Because matchmaking is heads-up (players: 2), the peer mesh has exactly one
 * remote peer, so the host's private-card message reaches only that player.
 * Hole cards never appear in the public state, and are only revealed at showdown.
 *
 * The pure engine/evaluator are exposed on `globalThis` so they can be tested
 * under `node` without a DOM.
 */
(function (root) {
  "use strict";

  // ══════════════════════════════════════════════════════════════════════════
  // 1. Evaluator (port of poker_eval.py)
  // ══════════════════════════════════════════════════════════════════════════

  const RANKS = "23456789TJQKA";
  const SUITS = "cdhs"; // clubs, diamonds, hearts, spades
  const CATEGORIES = [
    "high_card",
    "pair",
    "two_pair",
    "three_of_a_kind",
    "straight",
    "flush",
    "full_house",
    "four_of_a_kind",
    "straight_flush",
  ];
  const CATEGORY_INDEX = {};
  CATEGORIES.forEach((category, index) => { CATEGORY_INDEX[category] = index; });

  const RANK_VALUE = {};
  for (let i = 0; i < RANKS.length; i++) RANK_VALUE[RANKS[i]] = i + 2;

  function parseCard(card) {
    if (typeof card !== "string" || card.length !== 2) {
      throw new Error("Invalid card: " + card);
    }
    const value = RANK_VALUE[card[0]];
    const suit = SUITS.indexOf(card[1]);
    if (value === undefined || suit < 0) throw new Error("Invalid card: " + card);
    return [value, card[1]];
  }

  function isStraight(ranksDesc) {
    if (ranksDesc.length < 5) return [false, 0];
    // Wheel: A-5-4-3-2 plays as a five-high straight.
    if (
      ranksDesc[0] === 14 && ranksDesc[1] === 5 && ranksDesc[2] === 4 &&
      ranksDesc[3] === 3 && ranksDesc.indexOf(2) >= 0
    ) {
      return [true, 5];
    }
    for (let i = 0; i + 4 < ranksDesc.length; i++) {
      const window = ranksDesc.slice(i, i + 5);
      if (window[0] - window[4] === 4 && new Set(window).size === 5) return [true, window[0]];
    }
    return [false, 0];
  }

  function rank5(cards) {
    if (!Array.isArray(cards) || cards.length !== 5) {
      throw new Error("rank5 requires exactly 5 cards");
    }
    const parsed = cards.map(parseCard);
    const ranks = parsed.map((p) => p[0]).sort((a, b) => b - a);
    const suits = parsed.map((p) => p[1]);
    const isFlush =
      suits[0] === suits[1] && suits[1] === suits[2] &&
      suits[2] === suits[3] && suits[3] === suits[4];

    const counts = {};
    for (const rank of ranks) counts[rank] = (counts[rank] || 0) + 1;
    const groups = Object.keys(counts)
      .map((key) => [counts[key], Number(key)])
      .sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    const uniqueDesc = Object.keys(counts).map(Number).sort((a, b) => b - a);
    const straight = isStraight(uniqueDesc);
    const isStraightMade = straight[0];
    const straightTop = straight[1];

    if (isFlush && isStraightMade) return { category: "straight_flush", rank: [straightTop] };

    if (groups[0][0] === 4) {
      const quad = groups[0][1];
      const kicker = Math.max(...uniqueDesc.filter((r) => r !== quad));
      return { category: "four_of_a_kind", rank: [quad, kicker] };
    }

    if (groups[0][0] === 3 && groups.length > 1 && groups[1][0] >= 2) {
      const trips = groups[0][1];
      const pairs = groups.slice(1).filter((g) => g[0] >= 2).map((g) => g[1]);
      return { category: "full_house", rank: [trips, Math.max(...pairs)] };
    }

    if (isFlush) return { category: "flush", rank: ranks.slice() };

    if (isStraightMade) return { category: "straight", rank: [straightTop] };

    if (groups[0][0] === 3) {
      const trips = groups[0][1];
      const kickers = uniqueDesc.filter((r) => r !== trips).sort((a, b) => b - a).slice(0, 2);
      return { category: "three_of_a_kind", rank: [trips, ...kickers] };
    }

    if (groups[0][0] === 2) {
      const pairs = groups.filter((g) => g[0] === 2).map((g) => g[1]).sort((a, b) => b - a);
      if (pairs.length >= 2) {
        const high = pairs[0];
        const low = pairs[1];
        const kicker = Math.max(...uniqueDesc.filter((r) => r !== high && r !== low));
        return { category: "two_pair", rank: [high, low, kicker] };
      }
      const pair = pairs[0];
      const kickers = uniqueDesc.filter((r) => r !== pair).sort((a, b) => b - a).slice(0, 3);
      return { category: "pair", rank: [pair, ...kickers] };
    }

    return { category: "high_card", rank: ranks.slice() };
  }

  function combinations5(cards) {
    const out = [];
    const n = cards.length;
    for (let a = 0; a < n - 4; a++) {
      for (let b = a + 1; b < n - 3; b++) {
        for (let c = b + 1; c < n - 2; c++) {
          for (let d = c + 1; d < n - 1; d++) {
            for (let e = d + 1; e < n; e++) {
              out.push([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            }
          }
        }
      }
    }
    return out;
  }

  /** Best 5-card hand from >= 5 cards (same scanning rule as best_of_7). */
  function bestOf(cards) {
    if (!Array.isArray(cards) || cards.length < 5) return null;
    if (cards.length === 5) return rank5(cards);
    let best = null;
    for (const combo of combinations5(cards)) {
      const strength = rank5(combo);
      if (!best || compare(best, strength) < 0) best = strength;
    }
    return best;
  }

  function bestOf7(cards) {
    if (!Array.isArray(cards) || cards.length !== 7) {
      throw new Error("best_of_7 requires 7 cards");
    }
    return bestOf(cards);
  }

  function compare(a, b) {
    const ai = CATEGORY_INDEX[a.category];
    const bi = CATEGORY_INDEX[b.category];
    if (ai !== bi) return ai > bi ? 1 : -1;
    const ra = a.rank;
    const rb = b.rank;
    const length = Math.max(ra.length, rb.length);
    for (let i = 0; i < length; i++) {
      const x = ra[i] === undefined ? 0 : ra[i];
      const y = rb[i] === undefined ? 0 : rb[i];
      if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
  }

  const HoldemEval = {
    RANKS, SUITS, CATEGORIES, CATEGORY_INDEX, RANK_VALUE,
    parseCard, isStraight, rank5, bestOf, bestOf7, compare,
  };
  root.HoldemEval = HoldemEval;

  // ══════════════════════════════════════════════════════════════════════════
  // 2. Engine (port of engine.py / game_state.py)
  // ══════════════════════════════════════════════════════════════════════════

  function makeDeck() {
    const deck = [];
    for (const rank of RANKS) for (const suit of SUITS) deck.push(rank + suit);
    return deck;
  }

  // Deterministic RNG so a hand can be replayed from a seed (and tested).
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(deck, rand) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }
    return deck;
  }

  const sum = (values) => values.reduce((total, value) => total + value, 0);

  function activeFrom(state, start, predicate) {
    for (let i = 0; i < state.seats; i++) {
      const seat = (start + i) % state.seats;
      if (predicate(seat)) return seat;
    }
    return null;
  }

  function canAct(state, seat) {
    return !state.folded[seat] && state.hole[seat] !== null && !state.allIn[seat];
  }

  function countInHand(state) {
    let count = 0;
    for (let seat = 0; seat < state.seats; seat++) {
      if (!state.folded[seat] && state.hole[seat] !== null) count += 1;
    }
    return count;
  }

  function roundComplete(state) {
    for (let seat = 0; seat < state.seats; seat++) {
      if (!canAct(state, seat)) continue;
      if (state.contribStreet[seat] !== state.currentBet || !state.acted[seat]) return false;
    }
    return true;
  }

  function nextActor(state, start) {
    return activeFrom(state, start, (seat) => canAct(state, seat));
  }

  function findBlinds(state) {
    const hasChips = (seat) => state.stacks[seat] > 0;
    const active = [];
    for (let seat = 0; seat < state.seats; seat++) if (hasChips(seat)) active.push(seat);
    if (active.length === 2) {
      const sb = hasChips(state.dealerSeat) ? state.dealerSeat : active[0];
      const bb = activeFrom(state, (sb + 1) % state.seats, hasChips);
      return { sb, bb };
    }
    const sb = activeFrom(state, (state.dealerSeat + 1) % state.seats, hasChips);
    const bb = sb === null ? null : activeFrom(state, (sb + 1) % state.seats, hasChips);
    return { sb, bb };
  }

  function postBlind(state, seat, amount, kind) {
    const pay = Math.min(amount, state.stacks[seat]);
    state.stacks[seat] -= pay;
    state.contribStreet[seat] += pay;
    state.contribTotal[seat] += pay;
    if (state.stacks[seat] === 0) state.allIn[seat] = true;
    state.actions.push({ street: "preflop", seat, type: kind, amount: pay });
  }

  function buildLegalFor(state, seat) {
    const stack = state.stacks[seat];
    const toCall = Math.max(0, state.currentBet - state.contribStreet[seat]);
    const legal = [{ type: "fold" }];
    if (toCall === 0) legal.push({ type: "check" });
    else legal.push({ type: "call", amount: Math.min(toCall, stack) });
    if (stack > toCall) {
      let minTotal = state.currentBet > 0
        ? state.currentBet + Math.max(state.lastRaise, state.bigBlind)
        : state.bigBlind;
      minTotal = Math.max(minTotal, state.currentBet + 1);
      const maxTotal = state.contribStreet[seat] + stack;
      if (maxTotal >= minTotal) legal.push({ type: "raise", min: minTotal, max: maxTotal });
    }
    return { seat, toCall, legal };
  }

  function normalizeAction(raw, toCall) {
    const fallback = toCall === 0 ? { type: "check" } : { type: "call" };
    if (!raw || typeof raw !== "object" || typeof raw.type !== "string") return fallback;
    if (raw.type === "fold" || raw.type === "check" || raw.type === "call") {
      return { type: raw.type };
    }
    if (raw.type === "raise") {
      const amount = Number(raw.amount);
      if (!Number.isFinite(amount) || amount <= 0) return fallback;
      return { type: "raise", amount: Math.floor(amount) };
    }
    return fallback;
  }

  function applyCall(state, seat, toCall, street) {
    const pay = Math.min(toCall, state.stacks[seat]);
    state.stacks[seat] -= pay;
    state.contribStreet[seat] += pay;
    state.contribTotal[seat] += pay;
    if (state.stacks[seat] === 0) state.allIn[seat] = true;
    state.actions.push({ street, seat, type: "call", amount: pay });
    state.acted[seat] = true;
  }

  function applyFallbackOrCheck(state, seat, toCall, street) {
    if (toCall === 0) {
      state.actions.push({ street, seat, type: "check" });
      state.acted[seat] = true;
      return;
    }
    applyCall(state, seat, toCall, street);
  }

  function applyRaise(state, seat, requested, info, street) {
    const raise = info.legal.find((action) => action.type === "raise");
    if (!raise) return false;
    let raiseTo = Math.max(raise.min, Math.min(raise.max, Math.floor(requested)));
    if (raiseTo <= state.currentBet) raiseTo = raise.min;
    const pay = Math.min(raiseTo - state.contribStreet[seat], state.stacks[seat]);
    const previousBet = state.currentBet;
    state.stacks[seat] -= pay;
    state.contribStreet[seat] += pay;
    state.contribTotal[seat] += pay;
    const newBet = Math.max(state.currentBet, state.contribStreet[seat]);
    state.lastRaise = Math.max(1, newBet - previousBet);
    state.currentBet = newBet;
    if (state.stacks[seat] === 0) state.allIn[seat] = true;
    for (let s = 0; s < state.seats; s++) state.acted[s] = false;
    state.acted[seat] = true;
    state.actions.push({ street, seat, type: "raise", to: newBet, amount: pay });
    return true;
  }

  function burnAndDeal(state, count) {
    if (state.deck.length) state.deck.pop(); // burn
    for (let i = 0; i < count && state.deck.length; i++) state.board.push(state.deck.pop());
  }

  function advanceStreet(state) {
    if (state.street === "preflop") { state.street = "flop"; burnAndDeal(state, 3); }
    else if (state.street === "flop") { state.street = "turn"; burnAndDeal(state, 1); }
    else if (state.street === "turn") { state.street = "river"; burnAndDeal(state, 1); }
    state.contribStreet = new Array(state.seats).fill(0);
    state.acted = new Array(state.seats).fill(false);
    state.currentBet = 0;
    state.lastRaise = state.bigBlind;
    state.toAct = null;
  }

  function computeSidePots(contribTotal, eligible) {
    const levels = Array.from(new Set(contribTotal.filter((value) => value > 0)))
      .sort((a, b) => a - b);
    const pots = [];
    let previous = 0;
    for (const level of levels) {
      const involved = [];
      for (let seat = 0; seat < contribTotal.length; seat++) {
        if (contribTotal[seat] >= level) involved.push(seat);
      }
      if (!involved.length) continue;
      const size = (level - previous) * involved.length;
      const elig = involved.filter((seat) => eligible[seat]);
      pots.push({ amount: size, eligible_seats: elig, winner_seats: [] });
      previous = level;
    }
    return pots;
  }

  function bestSeatsForPot(state, board5, eligibleSeats) {
    let best = eligibleSeats[0];
    let tied = [best];
    for (let i = 1; i < eligibleSeats.length; i++) {
      const seat = eligibleSeats[i];
      const cmp = HoldemEval.compare(
        HoldemEval.bestOf7((state.hole[seat] || []).concat(board5)),
        HoldemEval.bestOf7((state.hole[best] || []).concat(board5))
      );
      if (cmp > 0) { best = seat; tied = [seat]; }
      else if (cmp === 0) tied.push(seat);
    }
    return tied;
  }

  function awardTied(state, tied, amount) {
    const share = Math.floor(amount / tied.length);
    const remainder = amount % tied.length;
    for (let i = 0; i < tied.length; i++) {
      state.stacks[tied[i]] += share + (i < remainder ? 1 : 0);
    }
  }

  function settle(state) {
    if (state.handOver) return;
    const eligible = state.folded.map((folded) => !folded);
    const remaining = [];
    for (let seat = 0; seat < state.seats; seat++) if (eligible[seat]) remaining.push(seat);
    const sidePots = computeSidePots(state.contribTotal, eligible);

    if (remaining.length === 1) {
      const winner = remaining[0];
      state.stacks[winner] += sum(state.contribTotal);
      state.winners = [winner];
      state.sidePots = sidePots;
      state.shownHole = null; // uncontested: never reveal
      state.handOver = true;
      state.toAct = null;
      return;
    }

    const board5 = state.board.slice(0, 5);
    const winners = new Set();
    for (const pot of sidePots) {
      if (!pot.eligible_seats.length) continue;
      const tied = bestSeatsForPot(state, board5, pot.eligible_seats);
      awardTied(state, tied, pot.amount);
      pot.winner_seats = tied;
      tied.forEach((seat) => winners.add(seat));
    }
    state.winners = winners.size ? Array.from(winners).sort((a, b) => a - b) : remaining.slice();
    state.sidePots = sidePots;
    // Showdown: reveal every player who reached the end of the hand.
    state.shownHole = state.hole.map((hole, seat) => (state.folded[seat] ? null : (hole ? hole.slice() : null)));
    state.handOver = true;
    state.toAct = null;
  }

  function proceed(state, lastSeat) {
    let guard = 0;
    while (!state.handOver && guard++ < 40) {
      if (countInHand(state) <= 1) { settle(state); return; }
      if (roundComplete(state)) {
        if (state.street === "river") { settle(state); return; }
        advanceStreet(state);
        lastSeat = state.dealerSeat;
        continue;
      }
      const seat = nextActor(state, (lastSeat + 1) % state.seats);
      if (seat === null) {
        // Nobody left who can act; run the board to the end.
        if (state.street === "river") { settle(state); return; }
        advanceStreet(state);
        lastSeat = state.dealerSeat;
        continue;
      }
      state.toAct = seat;
      return;
    }
  }

  function startHand(options) {
    const seats = options.seats;
    const dealerSeat = ((options.dealerSeat % seats) + seats) % seats;
    const seed = (options.seed >>> 0) || 1;
    // `deck` is injectable so the engine can be cross-checked against the
    // original Python implementation with a fixed order; games never pass it.
    const deck = options.deck ? options.deck.slice() : shuffle(makeDeck(), mulberry32(seed));

    const state = {
      handId: options.handId || ("hand-" + seed),
      seats,
      startingStack: options.startingStack,
      smallBlind: options.smallBlind,
      bigBlind: options.bigBlind,
      dealerSeat,
      stacks: options.stacks.slice(),
      folded: new Array(seats).fill(false),
      allIn: new Array(seats).fill(false),
      hole: new Array(seats).fill(null),
      board: [],
      deck,
      street: "preflop",
      sbSeat: null,
      bbSeat: null,
      contribStreet: new Array(seats).fill(0),
      contribTotal: new Array(seats).fill(0),
      currentBet: 0,
      lastRaise: options.bigBlind,
      acted: new Array(seats).fill(false),
      toAct: null,
      actions: [],
      handOver: false,
      winners: [],
      sidePots: [],
      shownHole: null,
      seed,
    };

    for (let seat = 0; seat < seats; seat++) {
      if (state.stacks[seat] > 0) state.hole[seat] = [deck.pop(), deck.pop()];
    }
    const activePlayers = [];
    for (let seat = 0; seat < seats; seat++) if (state.stacks[seat] > 0) activePlayers.push(seat);
    if (activePlayers.length < 2) { state.handOver = true; return state; }

    const blinds = findBlinds(state);
    if (blinds.sb === null || blinds.bb === null) { state.handOver = true; return state; }
    state.sbSeat = blinds.sb;
    state.bbSeat = blinds.bb;
    postBlind(state, blinds.sb, options.smallBlind, "post_sb");
    postBlind(state, blinds.bb, options.bigBlind, "post_bb");
    state.currentBet = options.bigBlind;
    state.lastRaise = options.bigBlind;
    proceed(state, blinds.bb);
    return state;
  }

  function applyAction(state, raw) {
    if (state.handOver) throw new Error("hand is already over");
    if (state.toAct === null) throw new Error("there is no actor");
    const seat = state.toAct;
    const info = buildLegalFor(state, seat);
    const street = state.street;
    const normalized = normalizeAction(raw, info.toCall);

    if (normalized.type === "fold") {
      state.folded[seat] = true;
      state.acted[seat] = true;
      state.actions.push({ street, seat, type: "fold" });
    } else if (normalized.type === "check") {
      applyFallbackOrCheck(state, seat, info.toCall, street);
    } else if (normalized.type === "call") {
      applyCall(state, seat, info.toCall, street);
    } else if (normalized.type === "raise") {
      const raised = applyRaise(state, seat, normalized.amount, info, street);
      if (!raised) applyFallbackOrCheck(state, seat, info.toCall, street);
    } else {
      applyFallbackOrCheck(state, seat, info.toCall, street);
    }

    proceed(state, seat);
    return state;
  }

  function legalInfo(state) {
    if (state.toAct === null || state.handOver) return null;
    const info = buildLegalFor(state, state.toAct);
    return { seat: info.seat, toCall: info.toCall, actions: info.legal };
  }

  function potTotal(state) {
    return sum(state.contribTotal);
  }

  function madeHandCategory(hole, board) {
    const cards = hole.concat(board);
    if (cards.length < 5) return "high_card";
    const best = bestOf(cards);
    return best ? best.category : "high_card";
  }

  /** Visible bot-facing state — deliberately excludes every other hole card. */
  function botState(state, seat, handId) {
    const info = buildLegalFor(state, seat);
    const activeSeats = [];
    for (let s = 0; s < state.seats; s++) {
      if (!state.folded[s] && state.hole[s] !== null) activeSeats.push(s);
    }
    return {
      hand_id: handId || state.handId,
      street: state.street,
      actor_seat: seat,
      dealer_seat: state.dealerSeat,
      hole_cards: (state.hole[seat] || []).slice(),
      board_cards: state.board.slice(),
      stacks: state.stacks.slice(),
      contributed_this_street: state.contribStreet.slice(),
      contributed_total: state.contribTotal.slice(),
      pot: potTotal(state),
      action_history: state.actions.slice(),
      legal_actions: info.legal,
      hand_strength: { category: madeHandCategory(state.hole[seat] || [], state.board) },
      active_seats: activeSeats,
    };
  }

  function serializePublic(state) {
    return {
      handId: state.handId,
      seats: state.seats,
      dealerSeat: state.dealerSeat,
      sbSeat: state.sbSeat,
      bbSeat: state.bbSeat,
      street: state.street,
      board: state.board.slice(0, 5),
      stacks: state.stacks.slice(),
      folded: state.folded.slice(),
      allIn: state.allIn.slice(),
      contribStreet: state.contribStreet.slice(),
      contribTotal: state.contribTotal.slice(),
      pot: potTotal(state),
      currentBet: state.currentBet,
      toAct: state.toAct,
      handOver: state.handOver,
      winners: state.winners.slice(),
      sidePots: state.sidePots.map((pot) => ({
        amount: pot.amount,
        eligible_seats: pot.eligible_seats.slice(),
        winner_seats: (pot.winner_seats || []).slice(),
      })),
      holeCounts: state.hole.map((hole) => (hole ? hole.length : 0)),
      // Only populated at showdown; it is null for an uncontested pot.
      shownHole: state.shownHole ? state.shownHole.map((hole) => (hole ? hole.slice() : null)) : null,
      legal: legalInfo(state),
      actions: state.actions.slice(-16),
    };
  }

  const HoldemEngine = {
    makeDeck,
    mulberry32,
    startHand,
    applyAction,
    legalInfo,
    serializePublic,
    botState,
    computeSidePots,
    countInHand,
    potTotal,
  };
  root.HoldemEngine = HoldemEngine;

  if (typeof document === "undefined") return;

  // ══════════════════════════════════════════════════════════════════════════
  // 3. Bot personalities (imitation of bot_sandbox / services bots)
  // ══════════════════════════════════════════════════════════════════════════

  const BOT_ARCHETYPES = [
    "baseline",
    "calling_station",
    "maniac",
    "scaredy",
    "min_raise",
    "random",
    "superstitious",
    "overconfident",
    "pot_committed",
  ];

  function botDecide(archetype, gameState) {
    const legal = gameState.legal_actions || [];
    const has = (type) => legal.some((action) => action.type === type);
    const raiseInfo = legal.find((action) => action.type === "raise") || null;
    const actor = gameState.actor_seat;

    switch (archetype) {
      case "calling_station":
        if (has("call")) return { type: "call" };
        if (has("check")) return { type: "check" };
        return { type: "fold" };
      case "maniac":
        if (raiseInfo) return { type: "raise", amount: gameState.stacks[actor] + gameState.contributed_this_street[actor] };
        if (has("call")) return { type: "call" };
        if (has("check")) return { type: "check" };
        return { type: "fold" };
      case "scaredy":
        if (has("check")) return { type: "check" };
        return { type: "fold" };
      case "min_raise":
        if (raiseInfo) return { type: "raise", amount: raiseInfo.min };
        if (has("call")) return { type: "call" };
        if (has("check")) return { type: "check" };
        return { type: "fold" };
      case "random": {
        if (!legal.length) return { type: "fold" };
        const pot = gameState.pot | 0;
        const action = legal[pot % legal.length];
        if (action.type === "raise") {
          const spread = action.max - action.min;
          const amount = spread > 0 ? action.min + (pot % (spread + 1)) : action.min;
          return { type: "raise", amount };
        }
        return { type: action.type };
      }
      case "superstitious": {
        const hole = gameState.hole_cards || [];
        if (gameState.street === "preflop" && hole.length === 2) {
          const [first, second] = hole;
          const lucky = first[0] === "7" || second[0] === "7" ||
            first[0] === "A" || second[0] === "A" || first[1] === second[1];
          if (!lucky) return { type: "fold" };
        }
        if (has("check")) return { type: "check" };
        if (has("call")) return { type: "call" };
        return { type: "fold" };
      }
      case "overconfident": {
        const category = gameState.hand_strength && gameState.hand_strength.category;
        if (category && category !== "high_card") {
          if (raiseInfo) return { type: "raise", amount: gameState.stacks[actor] + gameState.contributed_this_street[actor] };
          if (has("call")) return { type: "call" };
        }
        if (has("check")) return { type: "check" };
        if (has("call")) return { type: "call" };
        return { type: "fold" };
      }
      case "pot_committed": {
        const invested = gameState.contributed_total[actor] || 0;
        if (invested > 50) {
          if (has("call")) return { type: "call" };
          if (has("check")) return { type: "check" };
          if (raiseInfo) return { type: "raise", amount: raiseInfo.min };
        }
        if (has("check")) return { type: "check" };
        if (has("call")) return { type: "call" };
        return { type: "fold" };
      }
      case "baseline":
      default:
        if (has("check")) return { type: "check" };
        if (has("call")) return { type: "call" };
        return { type: "fold" };
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. UI + networking
  // ══════════════════════════════════════════════════════════════════════════

  const $ = (id) => document.getElementById(id);
  const els = {
    tag: $("tag"),
    mode: $("mode"),
    seats: $("seats"),
    board: $("board"),
    pot: $("pot"),
    status: $("status"),
    stats: $("stats"),
    controls: $("controls"),
    fold: $("fold"),
    call: $("call"),
    raise: $("raise"),
    raiseAmount: $("raise-amount"),
    raiseSlider: $("raise-slider"),
    allin: $("allin"),
    nextHand: $("next-hand"),
    overlay: $("overlay"),
    overlayTitle: $("overlay-title"),
    overlayBody: $("overlay-body"),
    overlayBtn: $("overlay-btn"),
    overlayOnline: $("overlay-online"),
    seatChoices: $("seat-choices"),
  };

  const overlayUI = GameKit.overlay({
    overlay: els.overlay,
    title: els.overlayTitle,
    body: els.overlayBody,
    button: els.overlayBtn,
  });

  const U = {
    mode: "solo",
    seatPref: 6,
    names: [],
    humanSeats: [0],
    isBot: [],
    mySeat: 0,
    isHost: true,
    session: null,
    view: null,
    myHole: [],
    handStartStacks: [],
    stacks: [],
    dealerSeat: 0,
    handIndex: 0,
    seedBase: (Math.random() * 1e9) | 0,
    endedHandId: null,
    nextTimer: null,
    botTimer: null,
    actionTimer: null,
    botDelay: 420,
    profile: [],
    reflect: false,
    lastResult: "loss",
    lastPotWon: 0,
    firstHandUnlocked: false,
    lastSubmit: 0,
    stats: { hands_played: 0, hands_won: 0, chips_won: 0, biggest_pot: 0, all_in_win: 0 },
    online: { matchId: null, myId: null, oppId: null, channel: null, hostSeat: 0, guestSeat: 1 },
    seatEls: [],
    config: { seats: 6, startingStack: 1000, smallBlind: 10, bigBlind: 20 },
  };

  // ── Small DOM builders ────────────────────────────────────────────────────

  const SUIT_SYMBOL = { c: "♣", d: "♦", h: "♥", s: "♠" };

  function cardHtml(card) {
    if (!card) return '<span class="card placeholder"></span>';
    const rank = card[0] === "T" ? "10" : card[0];
    const symbol = SUIT_SYMBOL[card[1]] || "?";
    const red = card[1] === "d" || card[1] === "h";
    return '<span class="card' + (red ? " red" : "") + '">' +
      '<span class="rank">' + rank + "</span>" +
      '<span class="suit">' + symbol + "</span></span>";
  }

  function seatPositions(count) {
    const positions = [];
    for (let i = 0; i < count; i++) {
      const angle = Math.PI / 2 + (i * 2 * Math.PI) / count;
      const x = 50 + 44 * Math.cos(angle);
      const y = 54 + 40 * Math.sin(angle);
      positions.push({ x: Math.max(7, Math.min(93, x)), y: Math.max(9, Math.min(94, y)) });
    }
    return positions;
  }

  function buildSeatElements(count) {
    els.seats.innerHTML = "";
    U.seatEls = [];
    const positions = seatPositions(count);
    for (let i = 0; i < count; i++) {
      const seat = document.createElement("div");
      seat.className = "seat";
      seat.dataset.seat = String(i);
      seat.style.left = positions[i].x + "%";
      seat.style.top = positions[i].y + "%";
      seat.innerHTML =
        '<div class="seat-cards"></div>' +
        '<div class="seat-info">' +
        '<span class="seat-name"></span>' +
        '<span class="seat-stack"></span>' +
        '<span class="seat-status"></span>' +
        "</div>" +
        '<span class="seat-bet" hidden></span>' +
        '<span class="dealer-chip" hidden>D</span>';
      els.seats.appendChild(seat);
      U.seatEls.push({
        root: seat,
        cards: seat.querySelector(".seat-cards"),
        name: seat.querySelector(".seat-name"),
        stack: seat.querySelector(".seat-stack"),
        status: seat.querySelector(".seat-status"),
        bet: seat.querySelector(".seat-bet"),
        dealer: seat.querySelector(".dealer-chip"),
      });
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  function render() {
    const view = U.view;
    els.board.innerHTML = view ? view.board.map(cardHtml).join("") : "";
    els.pot.textContent = "Pot · " + (view ? view.pot : 0);
    if (view && U.seatEls.length === view.seats) {
      for (let seat = 0; seat < view.seats; seat++) renderSeat(seat);
    }
    renderControls();
    renderStatus();
    renderStatsLabel();
  }

  function renderSeat(seat) {
    const view = U.view;
    const el = U.seatEls[seat];
    if (!el) return;
    el.root.classList.toggle("me", seat === U.mySeat);
    el.root.classList.toggle("active", view.toAct === seat && !view.handOver);
    el.root.classList.toggle("folded", view.folded[seat]);
    el.root.classList.toggle("winner", view.handOver && view.winners.indexOf(seat) >= 0);
    el.name.textContent = U.names[seat] || "Seat " + (seat + 1);
    el.stack.textContent = view.stacks[seat] + " chips";

    let status = "";
    if (view.folded[seat]) status = "Folded";
    else if (view.allIn[seat]) status = "All-in";
    else if (view.toAct === seat && !view.handOver) status = "Acting";
    else if (seat === U.mySeat) status = "You";
    el.status.textContent = status;

    el.bet.hidden = !(view.contribStreet[seat] > 0);
    el.bet.textContent = String(view.contribStreet[seat]);
    el.dealer.hidden = view.dealerSeat !== seat;

    let html = "";
    if (view.shownHole && view.shownHole[seat]) {
      html = view.shownHole[seat].map(cardHtml).join("");
    } else if (seat === U.mySeat && U.myHole && U.myHole.length) {
      html = U.myHole.map(cardHtml).join("");
    } else {
      const hidden = view.holeCounts[seat] || 0;
      for (let i = 0; i < hidden; i++) html += '<span class="card back"></span>';
    }
    el.cards.innerHTML = html;
  }

  function renderControls() {
    const view = U.view;
    const myTurn = Boolean(view) && !view.handOver && view.toAct === U.mySeat &&
      Boolean(view.legal) && view.legal.seat === U.mySeat;

    els.fold.disabled = !myTurn;
    if (!myTurn) {
      els.call.disabled = true;
      els.raise.disabled = true;
      els.allin.disabled = true;
      els.raiseAmount.disabled = true;
      els.raiseSlider.disabled = true;
      return;
    }

    const legal = view.legal;
    const check = legal.actions.find((action) => action.type === "check");
    const call = legal.actions.find((action) => action.type === "call");
    const raise = legal.actions.find((action) => action.type === "raise");

    if (call) {
      els.call.textContent = "Call " + call.amount;
      els.call.disabled = false;
    } else if (check) {
      els.call.textContent = "Check";
      els.call.disabled = false;
    } else {
      els.call.textContent = "Check";
      els.call.disabled = true;
    }

    if (raise) {
      els.raise.disabled = false;
      els.allin.disabled = false;
      els.raiseAmount.disabled = false;
      els.raiseSlider.disabled = false;
      els.raiseSlider.min = String(raise.min);
      els.raiseSlider.max = String(raise.max);
      els.raiseAmount.min = String(raise.min);
      els.raiseAmount.max = String(raise.max);
      let value = Number(els.raiseAmount.value);
      if (!Number.isFinite(value) || value < raise.min || value > raise.max) value = raise.min;
      els.raiseAmount.value = String(value);
      els.raiseSlider.value = String(value);
    } else {
      els.raise.disabled = true;
      els.allin.disabled = true;
      els.raiseAmount.disabled = true;
      els.raiseSlider.disabled = true;
    }
  }

  function renderStatus() {
    const view = U.view;
    if (!view) { els.status.textContent = "Loading…"; return; }
    if (view.handOver) {
      const names = view.winners.map((seat) => U.names[seat] || "Seat " + (seat + 1)).join(", ");
      els.status.textContent = names ? "Hand complete — " + names + " won the pot." : "Hand complete.";
      return;
    }
    if (view.toAct === U.mySeat) { els.status.textContent = "Your turn."; return; }
    if (view.toAct !== null && U.isBot[view.toAct]) {
      els.status.textContent = (U.names[view.toAct] || "Bot") + " is thinking…";
      return;
    }
    if (view.toAct !== null) {
      els.status.textContent = "Waiting for " + (U.names[view.toAct] || "player") + "…";
      return;
    }
    els.status.textContent = "";
  }

  function renderStatsLabel() {
    els.stats.textContent = "Hands " + U.stats.hands_played + " · Won " +
      U.stats.hands_won + " · Chips " + U.stats.chips_won;
  }

  // ── Action helpers ────────────────────────────────────────────────────────

  function sanitizeAction(action, legal) {
    if (!action || !legal || !Array.isArray(legal.actions)) return null;
    const allowed = legal.actions.map((entry) => entry.type);
    if (allowed.indexOf(action.type) < 0) return null;
    if (action.type === "raise") {
      const raise = legal.actions.find((entry) => entry.type === "raise");
      let amount = Math.floor(Number(action.amount));
      if (!Number.isFinite(amount)) return null;
      amount = Math.max(raise.min, Math.min(raise.max, amount));
      return { type: "raise", amount };
    }
    return { type: action.type };
  }

  function humanAction(action) {
    if (U.mode === "online" && !U.isHost) {
      if (!U.view || U.view.handOver || U.view.toAct !== U.mySeat) return;
      send({ t: "action", handId: U.view.handId, seat: U.mySeat, action });
      return;
    }
    if (!U.session || U.session.handOver || U.session.toAct !== U.mySeat) return;
    const legal = HoldemEngine.legalInfo(U.session);
    const sanitized = sanitizeAction(action, legal);
    if (!sanitized) return;
    HoldemEngine.applyAction(U.session, sanitized);
    afterEngineChange();
  }

  function afterEngineChange() {
    if (!U.session) return;
    if (U.session.allIn[U.mySeat]) U.reflect = true;
    U.view = HoldemEngine.serializePublic(U.session);
    U.myHole = U.session.hole[U.mySeat] ? U.session.hole[U.mySeat].slice() : [];
    if (U.isHost) broadcastState();
    render();
    if (U.view.handOver) { finishHand(); return; }
    scheduleBotIfNeeded();
    scheduleActionClock();
  }

  function scheduleBotIfNeeded() {
    clearTimeout(U.botTimer);
    if (!U.session || U.session.handOver) return;
    const seat = U.session.toAct;
    if (seat === null || !U.isBot[seat]) return;
    U.botTimer = setTimeout(() => {
      if (!U.session || U.session.handOver || U.session.toAct !== seat) return;
      const state = HoldemEngine.botState(U.session, seat, U.view.handId);
      const action = botDecide(U.profile[seat] || "baseline", state);
      const legal = HoldemEngine.legalInfo(U.session);
      const sanitized = sanitizeAction(action, legal);
      HoldemEngine.applyAction(U.session, sanitized || { type: "fold" });
      afterEngineChange();
    }, U.botDelay);
  }

  function scheduleActionClock() {
    clearTimeout(U.actionTimer);
    if (!U.isHost || !U.session || U.session.handOver) return;
    if (U.session.toAct !== U.online.guestSeat) return;
    U.actionTimer = setTimeout(() => {
      if (!U.session || U.session.handOver || U.session.toAct !== U.online.guestSeat) return;
      const legal = HoldemEngine.legalInfo(U.session);
      const check = legal.actions.find((entry) => entry.type === "check");
      const call = legal.actions.find((entry) => entry.type === "call");
      const action = check ? { type: "check" } : call ? { type: "call" } : { type: "fold" };
      HoldemEngine.applyAction(U.session, action);
      afterEngineChange();
    }, 30000);
  }

  // ── Hand / table lifecycle ────────────────────────────────────────────────

  function initTable(options) {
    clearTimeout(U.botTimer);
    clearTimeout(U.nextTimer);
    clearTimeout(U.actionTimer);
    U.config = {
      seats: options.seats,
      startingStack: options.startingStack || 1000,
      smallBlind: options.smallBlind || 10,
      bigBlind: options.bigBlind || 20,
    };
    U.humanSeats = options.humanSeats.slice();
    U.names = options.names.slice();
    U.isBot = [];
    for (let i = 0; i < options.seats; i++) U.isBot[i] = U.humanSeats.indexOf(i) < 0;
    U.mySeat = options.mySeat;
    U.isHost = options.isHost !== false;
    U.stacks = new Array(options.seats).fill(U.config.startingStack);
    U.dealerSeat = 0;
    U.handIndex = 0;
    U.session = null;
    U.view = null;
    U.myHole = [];
    U.endedHandId = null;
    U.trackedHandId = null;
    U.profile = [];
    for (let i = 0; i < options.seats; i++) {
      U.profile[i] = BOT_ARCHETYPES[(i + options.seats) % BOT_ARCHETYPES.length];
    }
    buildSeatElements(options.seats);
    render();
  }

  function dealNextHand() {
    clearTimeout(U.botTimer);
    clearTimeout(U.nextTimer);
    clearTimeout(U.actionTimer);
    if (!U.session) {
      U.stacks = new Array(U.config.seats).fill(U.config.startingStack);
    }
    for (let i = 0; i < U.config.seats; i++) {
      if (!Number.isFinite(U.stacks[i]) || U.stacks[i] <= 0) U.stacks[i] = U.config.startingStack;
    }
    U.dealerSeat = (U.dealerSeat + 1) % U.config.seats;
    U.handIndex += 1;
    const seed = (U.seedBase + U.handIndex * 7919) >>> 0;
    const state = HoldemEngine.startHand({
      seats: U.config.seats,
      startingStack: U.config.startingStack,
      smallBlind: U.config.smallBlind,
      bigBlind: U.config.bigBlind,
      dealerSeat: U.dealerSeat,
      stacks: U.stacks.slice(),
      seed,
      handId: U.mode + "-" + U.handIndex,
    });
    U.session = state;
    U.handStartStacks = state.stacks.slice();
    U.reflect = false;
    U.trackedHandId = null;
    U.myHole = state.hole[U.mySeat] ? state.hole[U.mySeat].slice() : [];
    overlayUI.hide();
    afterEngineChange();
  }

  function updateStats() {
    const view = U.view;
    if (!view) return;
    const me = U.mySeat;
    if (view.allIn[me]) U.reflect = true;
    const won = view.winners.indexOf(me) >= 0;
    U.lastResult = won ? "win" : "loss";
    const potWon = (view.sidePots || [])
      .filter((pot) => (pot.winner_seats || []).indexOf(me) >= 0)
      .reduce((total, pot) => total + (pot.amount || 0), 0);
    U.lastPotWon = potWon;
    U.stats.hands_played += 1;
    if (won) U.stats.hands_won += 1;
    if (potWon > 0) U.stats.chips_won += potWon;
    if (potWon > U.stats.biggest_pot) U.stats.biggest_pot = potWon;
    if (U.reflect && won) U.stats.all_in_win += 1;
  }

  function finishHand() {
    const handId = U.view ? U.view.handId : null;
    if (!handId || U.endedHandId === handId) return;
    U.endedHandId = handId;
    if (U.session) U.stacks = U.session.stacks.slice();
    updateStats();
    persistStats();
    submitRun();
    showResult();
    render();
    if (U.mode === "solo" || (U.mode === "online" && U.isHost)) {
      U.nextTimer = setTimeout(() => { dealNextHand(); }, 2800);
    }
  }

  function persistStats() {
    if (!root.Gamebase || !Gamebase.player) return;
    Gamebase.saveState({ stats: U.stats, firstHandUnlocked: U.firstHandUnlocked }).catch(() => {});
  }

  function submitRun() {
    if (!root.Gamebase || !Gamebase.player) return;
    const now = Date.now();
    const unlocks = [];
    if (!U.firstHandUnlocked) unlocks.push("first-hand");
    if (now - U.lastSubmit < 3200 && unlocks.length === 0) return;
    U.lastSubmit = now;
    const meta = {
      result: U.lastResult,
      hands_played: U.stats.hands_played,
      hands_won: U.stats.hands_won,
      chips_won: U.stats.chips_won,
      biggest_pot: U.stats.biggest_pot,
      all_in_win: U.stats.all_in_win,
      mode: U.mode,
    };
    Gamebase.checkpoint({ score: U.stats.chips_won, meta, unlock: unlocks })
      .then(() => { if (unlocks.length) U.firstHandUnlocked = true; })
      .catch((error) => console.warn("[holdem] checkpoint failed", error));
  }

  // ── Overlays ──────────────────────────────────────────────────────────────

  function showMenu() {
    clearTimeout(U.nextTimer);
    overlayUI.show(
      "Hold 'Em Together",
      "Play a 2–6 seat table against bots, or go online for peer-to-peer heads-up poker. " +
      "Real blinds, betting rounds, side pots and all-in showdowns.",
      "Play vs bots",
      () => startSolo(U.seatPref)
    );
    els.overlayOnline.hidden = false;
    els.seatChoices.hidden = false;
    els.nextHand.hidden = true;
  }

  function showResult() {
    const view = U.view;
    if (!view) return;
    const me = U.mySeat;
    const iWon = view.winners.indexOf(me) >= 0;
    const names = view.winners.map((seat) => U.names[seat] || "Seat " + (seat + 1)).join(", ");
    const holeLine = U.myHole && U.myHole.length ? " Your cards: " + U.myHole.join(" ") + "." : "";
    const body = "Pot " + view.pot + " chips — won by " + (names || "—") + "." + holeLine;
    const canDeal = U.mode === "solo" || (U.mode === "online" && U.isHost);
    overlayUI.show(
      iWon ? "You win the hand!" : "Hand over",
      body,
      canDeal ? "Next hand" : null,
      () => dealNextHand()
    );
    els.overlayOnline.hidden = true;
    els.seatChoices.hidden = true;
    els.nextHand.hidden = !canDeal;
  }

  // ── Solo ──────────────────────────────────────────────────────────────────

  function startSolo(seats) {
    const count = Math.max(2, Math.min(6, Number(seats) || U.seatPref || 6));
    U.seatPref = count;
    U.mode = "solo";
    const handle = root.Gamebase && Gamebase.player
      ? String(Gamebase.player.handle || "YOU").toUpperCase().slice(0, 10)
      : "YOU";
    const names = [handle];
    for (let i = 1; i < count; i++) names.push("BOT " + i);
    initTable({ seats: count, humanSeats: [0], names, mySeat: 0, isHost: true });
    dealNextHand();
  }

  // ── Online (host-authoritative P2P) ───────────────────────────────────────

  function resetOnline() {
    if (U.online.channel) { try { U.online.channel.close(); } catch (error) { /* gone */ } }
    U.online = { matchId: null, myId: null, oppId: null, channel: null, hostSeat: 0, guestSeat: 1 };
    U.session = null;
    U.view = null;
    U.myHole = [];
    U.stacks = [];
    clearTimeout(U.botTimer);
    clearTimeout(U.nextTimer);
    clearTimeout(U.actionTimer);
  }

  function send(message) {
    if (!U.online.channel) return;
    try { U.online.channel.send(message); } catch (error) { /* channel gone */ }
  }

  function broadcastState() {
    if (!U.isHost || !U.online.channel || !U.session || !U.view) return;
    send({
      t: "sync",
      handId: U.view.handId,
      config: {
        seats: U.config.seats,
        startingStack: U.config.startingStack,
        smallBlind: U.config.smallBlind,
        bigBlind: U.config.bigBlind,
        names: U.names,
        humanSeats: U.humanSeats,
      },
      view: U.view,
      hostSeat: 0,
      guestSeat: 1,
    });
    const guestSeat = U.online.guestSeat;
    const guestHole = U.session.hole[guestSeat];
    if (guestHole) {
      send({
        t: "private",
        handId: U.view.handId,
        seat: guestSeat,
        to: U.online.oppId,
        hole: guestHole.slice(),
      });
    }
  }

  function onPeerMessage(data) {
    if (!data || typeof data.t !== "string") return;
    if (data.t === "hello") {
      if (data.name) {
        U.online.oppName = String(data.name).toUpperCase().slice(0, 10);
        if (U.names.length) { U.names[U.online.guestSeat] = U.online.oppName; render(); }
        if (U.isHost) broadcastState();
      }
      return;
    }
    if (U.isHost) {
      if (data.t === "action") handleGuestAction(data);
      return;
    }
    if (data.t === "sync") applySync(data);
    else if (data.t === "private") {
      if (U.view && data.seat === U.mySeat && data.handId === U.view.handId) {
        U.myHole = Array.isArray(data.hole) ? data.hole.slice(0, 2) : [];
        render();
      }
    }
  }

  function handleGuestAction(data) {
    if (!U.session || U.session.handOver || !U.view) return;
    if (data.handId !== U.view.handId) return;
    if (U.session.toAct !== U.online.guestSeat) return;
    const legal = HoldemEngine.legalInfo(U.session);
    const action = sanitizeAction(data.action, legal);
    if (!action) return;
    HoldemEngine.applyAction(U.session, action);
    afterEngineChange();
  }

  function applySync(data) {
    const config = data.config || {};
    if (config.names) U.names = config.names.slice();
    if (Array.isArray(config.humanSeats)) U.humanSeats = config.humanSeats.slice();
    U.config = {
      seats: config.seats || U.config.seats,
      startingStack: config.startingStack || U.config.startingStack,
      smallBlind: config.smallBlind || U.config.smallBlind,
      bigBlind: config.bigBlind || U.config.bigBlind,
    };
    U.mySeat = typeof data.guestSeat === "number" ? data.guestSeat : U.mySeat;
    U.isBot = [];
    for (let i = 0; i < U.config.seats; i++) U.isBot[i] = U.humanSeats.indexOf(i) < 0;
    const isNewHand = !U.view || data.handId !== U.view.handId;
    if (isNewHand) {
      if (U.seatEls.length !== U.config.seats) buildSeatElements(U.config.seats);
      U.endedHandId = null;
      U.myHole = [];
      U.reflect = false;
    }
    U.view = data.view;
    if (isNewHand && U.view && !U.view.handOver) {
      // A fresh hand from the host: clear the previous result overlay.
      overlayUI.hide();
      els.nextHand.hidden = true;
    }
    render();
    if (U.view && U.view.handOver) finishHand();
  }

  async function startOnline() {
    U.mode = "online";
    els.mode.textContent = "Online";
    resetOnline();
    overlayUI.show("Finding an opponent…", "Searching the matchmaking queue for another player.", null, null);
    els.overlayOnline.hidden = true;
    els.seatChoices.hidden = true;
    els.nextHand.hidden = true;
    try {
      const match = await GameKit.online.findMatch(120000);
      if (!match) { showMenu(); return; }
      const myId = Gamebase.player.id;
      const hostId = match.players[0].player_id;
      U.isHost = myId === hostId;
      U.online.matchId = match.id;
      U.online.myId = myId;
      const opponent = match.players.find((player) => player.player_id !== myId) || {};
      U.online.oppId = opponent.player_id || null;
      U.mySeat = U.isHost ? 0 : 1;
      U.online.hostSeat = 0;
      U.online.guestSeat = 1;
      U.online.myName = String(Gamebase.player.handle || "YOU").toUpperCase().slice(0, 10);
      U.online.oppName = String(opponent.handle || "OPP").toUpperCase().slice(0, 10);

      const channel = await GameKit.online.peers(match.id);
      U.online.channel = channel;
      channel.on("open", () => {
        send({ t: "hello", name: U.online.myName });
        if (U.isHost) broadcastState();
      });
      channel.on("roster", () => {
        send({ t: "hello", name: U.online.myName });
        if (U.isHost) broadcastState();
      });
      channel.on("message", onPeerMessage);
      channel.on("close", () => {
        if (U.view && !U.view.handOver) els.status.textContent = "Connection lost.";
      });

      if (U.isHost) {
        const names = [U.online.myName, U.online.oppName];
        for (let i = 2; i < 6; i++) names.push("BOT " + (i - 1));
        initTable({ seats: 6, humanSeats: [0, 1], names, mySeat: 0, isHost: true });
        dealNextHand();
      } else {
        overlayUI.show("Waiting for the host…", "The host will deal the first hand.", null, null);
        els.overlayOnline.hidden = true;
        els.seatChoices.hidden = true;
      }
    } catch (error) {
      console.warn("[holdem] matchmaking failed", error);
      overlayUI.show(
        "Matchmaking failed",
        String(error && error.message ? error.message : error),
        "Try again",
        () => startOnline()
      );
      els.overlayOnline.hidden = true;
      els.seatChoices.hidden = true;
    }
  }

  // ── Input wiring ──────────────────────────────────────────────────────────

  els.fold.addEventListener("click", () => humanAction({ type: "fold" }));
  els.call.addEventListener("click", () => {
    const legal = U.view && U.view.legal;
    if (!legal) return;
    const canCall = legal.actions.some((action) => action.type === "call");
    humanAction(canCall ? { type: "call" } : { type: "check" });
  });
  els.raise.addEventListener("click", () => {
    humanAction({ type: "raise", amount: Number(els.raiseAmount.value) });
  });
  els.allin.addEventListener("click", () => {
    const legal = U.view && U.view.legal;
    if (!legal) return;
    const raise = legal.actions.find((action) => action.type === "raise");
    if (raise) humanAction({ type: "raise", amount: raise.max });
    else {
      const call = legal.actions.find((action) => action.type === "call");
      humanAction(call ? { type: "call" } : { type: "check" });
    }
  });
  els.raiseSlider.addEventListener("input", () => {
    els.raiseAmount.value = els.raiseSlider.value;
  });
  els.raiseAmount.addEventListener("input", () => {
    const value = Number(els.raiseAmount.value);
    if (Number.isFinite(value)) els.raiseSlider.value = String(value);
  });
  els.nextHand.addEventListener("click", () => dealNextHand());
  els.overlayOnline.addEventListener("click", () => startOnline());

  Array.prototype.forEach.call(els.seatChoices.querySelectorAll(".seat-choice"), (button) => {
    button.addEventListener("click", () => {
      U.seatPref = Number(button.dataset.seats) || 6;
      Array.prototype.forEach.call(els.seatChoices.querySelectorAll(".seat-choice"), (other) => {
        other.classList.toggle("selected", other === button);
      });
    });
  });

  GameKit.modeCycle(
    els.mode,
    ["solo", "online"],
    { solo: "Solo", online: "Online" },
    () => U.mode,
    (mode) => {
      U.mode = mode;
      if (mode === "online") startOnline();
      else startSolo(U.seatPref);
    }
  );

  // ── Debug / automation surface ────────────────────────────────────────────

  root.Holdem = {
    engine: HoldemEngine,
    eval: HoldemEval,
    botDecide,
    startSolo,
    startOnline,
    nextHand: dealNextHand,
    act(type, amount) { humanAction({ type, amount }); },
    autoAct() {
      const legal = U.view && U.view.legal;
      if (!U.view || U.view.handOver || U.view.toAct !== U.mySeat || !legal) return false;
      const check = legal.actions.find((action) => action.type === "check");
      const call = legal.actions.find((action) => action.type === "call");
      if (check) humanAction({ type: "check" });
      else if (call) humanAction({ type: "call" });
      else humanAction({ type: "fold" });
      return true;
    },
    setSpeed(ms) { U.botDelay = Math.max(0, Number(ms) || 0); },
    onlineMode() { return U.online.channel ? U.online.channel.mode : null; },
    state() {
      const view = U.view;
      const seats = view
        ? view.stacks.map((stack, seat) => ({
            stack,
            folded: view.folded[seat],
            allIn: view.allIn[seat],
            active: view.toAct === seat,
            hole: view.shownHole && view.shownHole[seat] ? view.shownHole[seat].slice() : null,
            holeCount: view.holeCounts[seat],
          }))
        : [];
      return {
        mode: U.mode,
        isHost: U.isHost,
        mySeat: U.mySeat,
        seats: U.config.seats,
        handId: view ? view.handId : null,
        handOver: view ? view.handOver : true,
        street: view ? view.street : null,
        toAct: view ? view.toAct : null,
        board: view ? view.board.slice() : [],
        pot: view ? view.pot : 0,
        myHole: U.myHole.slice(),
        winners: view ? view.winners.slice() : [],
        shownHole: view && view.shownHole ? view.shownHole.map((hole) => (hole ? hole.slice() : null)) : null,
        legal: view ? view.legal : null,
        seatsView: seats,
        actions: U.session ? U.session.actions.slice() : (view ? view.actions.slice() : []),
        overlayHidden: els.overlay.hidden,
        stats: Object.assign({}, U.stats),
        online: {
          matchId: U.online.matchId,
          isHost: U.isHost,
          mode: U.online.channel ? U.online.channel.mode : null,
          connected: U.online.channel ? U.online.channel.connected : false,
          peerIds: U.online.channel ? U.online.channel.peerIds : [],
        },
      };
    },
  };

  // ── Boot ──────────────────────────────────────────────────────────────────

  buildSeatElements(U.config.seats);
  render();
  showMenu();

  if (root.Gamebase) {
    Gamebase.ready()
      .then(async (player) => {
        GameKit.setTag(els.tag, player);
        try {
          const saved = await Gamebase.loadState();
          if (saved && saved.state) {
            Object.assign(U.stats, saved.state.stats || {});
            U.firstHandUnlocked = Boolean(saved.state.firstHandUnlocked);
          }
        } catch (error) { /* no saved state yet */ }
        renderStatsLabel();
        try {
          const best = await Gamebase.myBest();
          if (best && best.best !== null) {
            els.tag.textContent = player.handle + " · best " + best.best;
          }
        } catch (error) { /* no best yet */ }
      })
      .catch((error) => {
        els.tag.textContent = "guest";
        console.warn("[holdem] Gamebase unavailable", error);
      });
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
