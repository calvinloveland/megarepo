# Curated milestone mixes for Alchemist's Powder

This is a design note for **hard-coded milestone recipes**: mixes that should stay
consistent across runs even if most long-tail discoveries still come from the LLM.

The goal is not to hard-code everything. The goal is to make the game reliable at
**critical points** where inconsistency would hurt learning, progression, or trust.

## What counts as a critical point?

A mix is a good hard-code candidate when it is one of these:

1. **First-contact recipes**
   - The first few obvious experiments players try.
   - If these feel random, players stop trusting the system.

2. **Tool unlocks**
   - Especially `Heat` and `Pressure`, because they are core mechanics rather than flavor.
   - These should be discovered reliably and early enough to matter.

3. **Branch anchors**
   - A recipe that defines a whole thematic branch, like mud/clay, plant/oil, or brine/crystal.
   - Once the anchor is consistent, more exotic follow-ups can still be LLM-generated.

4. **Gold-path gates**
   - Any recipe that sits on the intended route to `Gold`.
   - If one of these is random, the endgame feels arbitrary instead of earned.

5. **Ancestor-rule-sensitive junctions**
   - Since compounds cannot mix with parent materials, some recipes are only fun if they
     are placed carefully on disjoint branches.
   - These branch junctions should be designed rather than improvised.

## Recommended hard-coded progression

## Tier 0: trustworthy first discoveries

These are the mixes many players will try first.

| Mix | Result | Why it should be fixed |
| --- | --- | --- |
| Water + Dirt | Mud | Most intuitive early recipe; teaches “obvious world logic”. |
| Water + Fire | Steam | Cleanly introduces energetic reactions. |
| Seed + Dirt | Plant | Establishes the life/growth branch. |
| Water + Salt | Brine | Establishes the salt/mineral branch. |
| Sand + Fire | Glass | Establishes the heat/refinement branch. |

### Notes
- `Water + Fire -> Steam` should also **reliably create Heat as a byproduct** so Heat is discovered early.
- These five recipes are enough to make the world feel coherent immediately.

## Tier 1: reliable unlocks for the two special tools

`Heat` and `Pressure` should be learnable, purposeful, and not purely random.

| Mix | Result | Why |
| --- | --- | --- |
| Water + Fire | Steam + Heat | Guaranteed Heat discovery path. |
| Steam + Iron | Pressure | Guaranteed Pressure discovery path. |

### Why `Steam + Iron -> Pressure` works well
- It feels like a primitive boiler / pressure vessel idea.
- It uses a discovered material (`Steam`) plus a starter (`Iron`), so it fits the ancestor rule.
- It makes `Pressure` feel like an engineered phenomenon, not a random magical token.

## Tier 2: stable branch anchors

These do not all need to be on the Gold path, but they make the world legible.

| Mix | Result | Role |
| --- | --- | --- |
| Mud + Fire | Clay | Refinement branch: wet earth -> workable earth. |
| Plant + Fire | Smoke | Obvious combustion result; supports atmosphere and further ideas. |
| Plant + Pressure | Oil | Gives Pressure an economy/resource use. |
| Brine + Pressure | Crystal | Defines the mineral refinement branch. |
| Iron + Fire | Steel | Defines the metal refinement branch. |

### Notes
- `Plant + Pressure -> Oil` is a good way to make Pressure feel economically useful, not just a gate.
- `Brine + Pressure -> Crystal` gives the salt branch a durable, high-value output.
- `Iron + Fire -> Steel` is an intuitive refinement step and creates a clean metal branch.

## Tier 3: deterministic Gold route

The endgame should be narrow, readable, and earned.

Recommended route:

1. `Water + Fire -> Steam` (+ `Heat`)
2. `Steam + Iron -> Pressure`
3. `Water + Salt -> Brine`
4. `Brine + Pressure -> Crystal`
5. `Iron + Fire -> Steel`
6. `Steel + Crystal + Pressure -> Gold`

## Why this route is good

### 1. It respects the ancestor rule
- `Steel` comes from the **Fire + Iron** branch.
- `Crystal` comes from the **Water + Salt** branch.
- Those branches are disjoint, so they can still combine later.
- `Pressure` can overlap ancestrally because it is used as a **catalyst**, not one of the pair materials.

### 2. It makes Pressure matter
- Pressure is not just a visual byproduct.
- It is required both to refine `Crystal` and to perform the final transmutation.

### 3. It creates a readable alchemy story
- Heat makes vapor.
- Vapor plus metal creates pressure.
- Pressure refines brine into crystal.
- Steel and crystal under pressure become gold.

This is not literal chemistry, but it feels like internally consistent alchemy.

## Recommended hard-coded set

If you want the **smallest useful curated set**, hard-code these first:

1. `Water + Dirt -> Mud`
2. `Water + Fire -> Steam` (+ Heat)
3. `Seed + Dirt -> Plant`
4. `Water + Salt -> Brine`
5. `Sand + Fire -> Glass`
6. `Steam + Iron -> Pressure`
7. `Brine + Pressure -> Crystal`
8. `Iron + Fire -> Steel`
9. `Steel + Crystal + Pressure -> Gold`

That gives you:
- trustworthy onboarding,
- deterministic Heat/Pressure unlocks,
- a clear midgame,
- and a reliable Gold win condition.

## Good candidates to leave to the LLM

After the milestones above are fixed, these can stay generative:

- weird side branches,
- cosmetic/fun compounds,
- nonessential plant derivatives,
- nonessential glass/mineral variants,
- off-path metal curiosities,
- “what if?” recipes players try for surprise.

That preserves novelty without making the core experience arbitrary.

## Practical implementation suggestion

A good rule of thumb:

- **Hard-code milestone recipes first.**
- **Check curated recipes before the LLM.**
- **Only fall back to LLM for non-curated pairs.**

That gives you consistency where it matters and surprise where it helps.
