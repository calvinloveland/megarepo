# Multi-Agent Hiring Plan for Manifold Trading

This document sketches a practical way to use the existing `pi-hiring-harness` as the orchestration layer for Manifold trading work.

The important design choice is:

- keep **hard risk and execution controls deterministic** in the Python trading framework
- use the **CEO + hired specialists** for research, synthesis, challenge, and market selection

That keeps the flashy agent layer away from the parts that can blow up the bankroll.

## Core objective

The CEO should not literally optimize for "maximum profit with minimum risk" because the literal minimum-risk strategy is often to not trade at all.

A better CEO objective is lexicographic:

1. **Do not violate hard risk constraints.**
2. **Maximize long-run risk-adjusted expected value.**
3. **Prefer simpler, more explainable trades when EV is similar.**
4. **Spend research budget only when the expected information gain is worth it.**

In plain English:

> Make money when the edge is real, size modestly, avoid ruin, and skip mediocre trades.

## What should stay deterministic

The current framework already has good places for hard rules:

- `active/dev-tools/tci-framework/src/tci_framework/config.py`
- `active/bots/manifold-trading-framework/src/manifold_trading_framework/execution.py`

Those should remain the final authority for:

- max bet size
- per-market exposure
- total risk
- minimum edge to trade
- minimum confidence to trade
- shadow-vs-live execution
- kill switches and daily drawdown stops

Agents can recommend trades.
Agents should **not** get to bypass these controls.

## System shape

Think of the system as three layers.

### 1. Deterministic trading layer

Owns:

- market ingestion
- replay
- comparison of policy variants
- bet sizing caps
- execution in shadow or live mode
- persistent run artifacts

This is the existing Python code.

### 2. CEO + specialist layer

Owns:

- deciding which markets deserve attention
- breaking a market review into bounded jobs
- comparing specialist outputs
- deciding whether there is enough edge to forward a thesis to execution
- deciding when to skip a trade

This is where `hire_workers` fits.

### 3. Learning and review layer

Owns:

- calibration tracking
- realized P/L by thesis type
- false positive / false negative review
- resume-vs-reality worker quality tracking
- which departments actually add value

This should use both the hiring ledger and the trading run artifacts.

## Recommended departments

The CEO is the only component with the global objective. Everyone else should have a narrow mandate.

### CEO

Responsibilities:

- choose which markets enter the funnel
- set research budget per market
- decide which specialists to hire
- synthesize contradictory evidence
- choose `skip`, `shadow trade`, or `live trade`
- decide when to escalate to human review

The CEO should be allowed to say:

- not enough edge
- too much ambiguity in resolution criteria
- correlated exposure already too high
- interesting market, but only shadow it for now

### Risk manager

Responsibilities:

- veto bad sizing
- detect correlated positions
- identify tail-risk and ambiguous-resolution markets
- recommend lower size, shadow-only mode, or no-trade
- define escalation triggers

This role should have veto power over live execution.

### Market researcher

Responsibilities:

- understand the exact market question
- identify the true resolution criteria
- gather key evidence and unresolved unknowns
- estimate a fair-value range, not fake precision

This worker should reduce ambiguity, not cheerlead.

### Arbitrage analyst

Responsibilities:

- find linked or contradictory Manifold markets
- detect incoherent prices across related questions
- identify structural opportunities from duplicated or badly coupled markets
- flag when liquidity is too thin to matter

This role is especially useful when edge comes from cross-market structure rather than deep world knowledge.

### PR / narrative analyst

This role should be defined narrowly and ethically.

Responsibilities:

- analyze public comment dynamics and reputation effects
- identify whether the market is being pushed by social momentum rather than evidence
- propose honest public explanations of the thesis if the bot ever comments
- flag manipulation risk, brigading, or creator-driven narrative distortions

Non-goals:

- no deception
- no sockpuppets
- no false claims
- no attempts to manipulate resolution or market sentiment dishonestly

A better name for this role might be **narrative analyst** if "PR" sounds too manipulative.

### Skeptic / red-team reviewer

Responsibilities:

- argue the best case against the proposed trade
- find hidden assumptions
- challenge probability estimates
- point out why the market might be right already
- distinguish strong objections from weak objections

This is one of the highest-value hires because it reduces overconfidence.

### Execution planner

Responsibilities:

- translate the final thesis into an actionable order plan
- propose size, entry band, and shadow/live mode
- ensure the trade respects deterministic caps
- specify what new evidence would invalidate the thesis

This role should prepare execution, not directly place orders.

### Postmortem reviewer

Responsibilities:

- review closed or resolved trades
- compare predicted edge to realized outcome
- separate bad luck from bad process
- update department scorecards

Without this role, the system will get theatrical instead of better.

## Recommended operating loops

### Loop 1: Market intake

Goal: decide whether a market deserves research spend at all.

Suggested order:

1. CEO runs a cheap triage pass.
2. Risk manager checks for obvious no-trade conditions.
3. If still interesting, hire market researcher and optionally arbitrage analyst.
4. CEO either drops the market or sends it to full review.

Good intake filters:

- enough liquidity to matter
- not too close to resolution if research latency makes action pointless
- clear enough resolution criteria
- not already at exposure cap through related markets

### Loop 2: Per-market thesis build

Goal: turn one market into a bounded research and decision workflow.

Parallel specialist jobs usually work best here:

- market researcher
- arbitrage analyst
- narrative analyst
- risk manager

Then a second wave:

- skeptic / red team
- execution planner

Then the CEO synthesizes.

A strong CEO output for one market is:

- thesis summary
- fair probability range
- current market probability
- estimated edge
- key assumptions
- invalidation conditions
- recommended action: `skip`, `shadow`, or `live`
- recommended max size

### Loop 3: Portfolio review

Goal: avoid death by many individually reasonable trades.

The CEO plus risk manager should periodically review:

- net YES/NO bias by topic
- correlated event clusters
- total open exposure
- concentration by market creator or information source
- unresolved markets with similar failure modes

This is where the risk manager should be strongest.

### Loop 4: Postmortem and calibration

For each resolved market, record:

- predicted fair value and confidence
- actual market path
- actual resolution
- whether the trade made money
- whether the thesis was right for the right reasons
- whether the risk manager warned correctly
- whether the skeptic surfaced the main failure mode

That data should feed back into both:

- the trading framework
- the hiring ledger for future worker selection

## Suggested CEO decomposition

For a single candidate market, the CEO can decompose work like this:

1. **Resolution scan**
   - What exactly resolves YES or NO?
   - Any loopholes or ambiguity?

2. **Base-rate and evidence scan**
   - What public facts matter most?
   - What evidence is missing?

3. **Cross-market scan**
   - Are there related markets with inconsistent prices?

4. **Narrative scan**
   - Are comments and public sentiment informative, noisy, or manipulative?

5. **Risk review**
   - What could make this trade far worse than it looks?

6. **Red-team critique**
   - What is the best argument that there is no real edge?

7. **Execution plan**
   - If trading, how much and at what target probability?

## Hireable job templates

These map cleanly onto `hire_workers` jobs.

### Job: market-triage

Use for:

- quick screening
- deciding whether to spend more budget

Acceptance criteria:

- classify market as `drop`, `watch`, or `research-now`
- state the main reason
- list one or two biggest unknowns

### Job: resolution-analysis

Acceptance criteria:

- quote the effective resolution rule
- identify ambiguity or loopholes
- explain what evidence would settle the market

### Job: edge-research

Acceptance criteria:

- provide a fair-value range
- separate hard evidence from speculation
- list the top uncertainty drivers

### Job: cross-market-arbitrage

Acceptance criteria:

- list directly linked markets
- explain the inconsistency
- estimate whether liquidity and fees make it tradable

### Job: narrative-analysis

Acceptance criteria:

- summarize comment dynamics
- identify high-trust vs low-trust voices
- flag obvious manipulation or social overreaction

### Job: risk-review

Acceptance criteria:

- state no-trade conditions
- propose a safe size cap
- identify portfolio-correlation concerns

### Job: thesis-red-team

Acceptance criteria:

- present the strongest counter-thesis
- list assumptions likely to fail
- recommend whether to downgrade confidence

### Job: execution-plan

Acceptance criteria:

- output `skip`, `shadow`, or `live`
- give max bet size and target probability band
- specify invalidation triggers

## Suggested worker set for this repo

Project-local worker profiles are included under:

- `.pi/workers/market-researcher.md`
- `.pi/workers/risk-manager.md`
- `.pi/workers/arbitrage-analyst.md`
- `.pi/workers/pr-analyst.md`
- `.pi/workers/reviewer.md`
- `.pi/workers/execution-planner.md`

These are intentionally narrow. The active Pi session is still the CEO.

## Example hiring round

A good first step is to run the agent system in **plan mode** while the Python framework stays in `shadow` mode.

Example payload shape:

```json
{
  "budgetUsd": 0.75,
  "mode": "plan",
  "workerScope": "project",
  "reviewMode": "none",
  "cwd": "active/bots/manifold-trading-framework",
  "jobs": [
    {
      "id": "resolution-analysis",
      "objective": "Read the market question, comments, and available local artifacts. Explain exactly how this market should resolve and identify any ambiguity that makes it unsafe to trade.",
      "acceptanceCriteria": "Return a clear resolution summary, ambiguity flags, and a recommendation: tradable or no-trade.",
      "preferredRole": "researcher",
      "maxBudgetUsd": 0.12
    },
    {
      "id": "cross-market-arbitrage",
      "objective": "Look for related Manifold markets or structural inconsistencies that could create edge. Be explicit when there is no real arbitrage.",
      "acceptanceCriteria": "List linked markets, price relationships, liquidity caveats, and whether any opportunity is actionable.",
      "preferredRole": "arbitrage",
      "maxBudgetUsd": 0.12
    },
    {
      "id": "narrative-analysis",
      "objective": "Analyze comment dynamics, reputation effects, and whether social momentum is likely distorting the price.",
      "acceptanceCriteria": "Separate evidence from vibes. Flag manipulation risk and summarize whether public narrative creates a mispricing opportunity.",
      "preferredRole": "pr",
      "maxBudgetUsd": 0.10
    },
    {
      "id": "risk-review",
      "objective": "Given the candidate trade thesis, propose hard veto conditions, safe sizing, and whether this market should be shadow-only.",
      "acceptanceCriteria": "State no-trade conditions, sizing cap, confidence downgrade conditions, and correlation concerns.",
      "preferredRole": "risk-manager",
      "maxBudgetUsd": 0.12
    },
    {
      "id": "thesis-red-team",
      "objective": "Attack the emerging trade thesis. Argue why the market price may already be correct or why the evidence is weaker than it looks.",
      "acceptanceCriteria": "Return the strongest counterargument, likely failure modes, and whether confidence should be reduced.",
      "preferredRole": "reviewer",
      "maxBudgetUsd": 0.12
    },
    {
      "id": "execution-plan",
      "objective": "If and only if the edge survives review, convert it into a bounded execution recommendation that respects existing framework risk caps.",
      "acceptanceCriteria": "Output skip/shadow/live, target probability, max size, and invalidation triggers.",
      "preferredRole": "execution-planner",
      "maxBudgetUsd": 0.12
    }
  ]
}
```

## Decision policy for the CEO

A practical CEO policy is:

### Say `skip` when

- resolution criteria are ambiguous
- edge is smaller than fees/slippage/noise
- the case depends too much on one low-trust source
- the red team finds a strong unanswered objection
- the market is attractive alone but bad in the context of current portfolio exposure

### Say `shadow` when

- the market is interesting but the process is not yet calibrated
- the thesis is good but confidence is modest
- the system wants to collect learning data before risking capital
- a new department or worker profile is being evaluated

### Say `live` only when

- resolution criteria are clear
- estimated edge is materially above threshold
- risk manager approves size
- the trade still looks good after red-team review
- deterministic risk caps allow it

## Strong recommendation on PR / commenting

If the bot will ever comment publicly on Manifold, treat that as a separate permission boundary.

Recommended rule:

- analysis of public narrative is allowed
- posting is off by default
- any public comment must be transparent, honest, and attributable
- no automated persuasion campaigns
- no false certainty
- no deceptive identity games

That keeps the system closer to market analysis than market manipulation.

## What to measure

If you want the organization to get better instead of more complicated, track these metrics.

### Trading metrics

- realized P/L
- realized P/L by market type
- Sharpe-like simple risk-adjusted return proxy
- max drawdown
- hit rate at different confidence bands
- average edge estimate vs realized edge

### Process metrics

- percent of markets dropped at intake
- percent of live trades that were previously shadowed
- average research cost per trade
- average time from intake to decision
- percent of decisions overturned by risk or red team

### Worker metrics

- prediction calibration
- review pass rate
- overconfidence rate
- how often the worker changes the CEO's decision materially
- whether the worker adds unique information or repeats others

## Recommended rollout

### Phase 1: planning only

- use `hire_workers` only in `plan` mode
- keep all actual trades in Python `shadow` mode
- store hiring ledgers and run results side by side

### Phase 2: shadow with agent-generated theses

- CEO and specialists propose trades
- deterministic framework executes only in shadow
- compare agent theses against baseline TCI variants

### Phase 3: constrained live trades

- live trading only for a tiny bankroll slice
- require both risk-manager approval and red-team review
- enforce daily loss stops outside the agent layer

### Phase 4: worker selection learning

- promote workers that add measurable value
- demote workers that are expensive and redundant
- introduce exploration budget only after stable calibration data exists

## Bottom line

The best version of this system is not a swarm of agents all allowed to trade.

It is:

- one CEO with the portfolio objective
- a few narrow specialists with clean mandates
- deterministic risk caps underneath everything
- a skeptical review loop
- a postmortem loop that learns which hires are worth paying for

That gives you separation of concerns without giving up control.
