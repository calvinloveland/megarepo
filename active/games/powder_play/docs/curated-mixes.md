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

## Tier 1: tool philosophy — Heat is a discovery, Pressure is a system

`Heat` and `Pressure` should not work the same way.

### Heat
Heat can still have a few reliable discovery moments.

| Mix | Result | Why |
| --- | --- | --- |
| Water + Fire | Steam + Heat | Guaranteed early Heat discovery. |
| Plant + Fire | Smoke + Heat | Reinforces that combustion creates Heat. |

### Pressure
Pressure should **not** be a single hard-coded recipe.
Instead, it should be a **reliable byproduct class** produced by many reactions that:
- rapidly create gas,
- expand liquid into vapor,
- combust violently,
- or happen in crowded / compressed spaces.

Good places for reliable Pressure byproducts:
- `Water + Fire -> Steam` in dense or enclosed situations
- `Plant + Fire -> Smoke` (small Pressure output)
- `Oil + Fire -> Smoke` (strong Pressure output)
- violent catalyzed reactions
- any reaction that produces a lot of gas or pushes into crowded cells

So the curated content for Pressure should mostly be:
- **rules about when Pressure is emitted**, not
- **one specific pair that creates Pressure**.

## Tier 2: stable branch anchors

These do not all need to be on the Gold path, but they make the world legible.

| Mix | Result | Role |
| --- | --- | --- |
| Mud + Fire | Clay | Refinement branch: wet earth -> workable earth. |
| Plant + Fire | Charcoal | Core metalworking ingredient. |
| Water + Salt | Brine | Mineral branch anchor. |
| Brine + Sand | Crystal | Clean salt/mineral refinement result. |
| Charcoal + Iron | Steel | Harder and more satisfying than `Iron + Fire -> Steel`. |
| Sand + Fire | Glass | Off-path but highly intuitive world logic. |

### Notes
- `Charcoal + Iron -> Steel` makes the metal branch longer and more earned.
- `Brine + Sand -> Crystal` creates a clean second branch that stays disjoint from the steel branch.
- `Glass` can remain important for side discoveries without necessarily being on the Gold path.

## Tier 3: deterministic Gold route (hard mode)

Gold should be difficult, legible, and late.
It should feel like the player mastered the whole system, not just guessed one lucky pair.

Recommended route:

### Metal branch
1. `Seed + Dirt -> Plant`
2. `Plant + Fire -> Charcoal`
3. `Charcoal + Iron -> Steel`

### Mineral branch
4. `Water + Salt -> Brine`
5. `Brine + Sand -> Crystal`

### Final transmutation
6. `Steel + Crystal + Pressure -> Gold`

### Optional extra gate
If Gold still feels too easy, require **both Heat and Pressure adjacent** for the final transmutation.
That would make Gold a true endgame reaction without making the recipe tree itself unreadable.

## Why this route is better

### 1. It is meaningfully harder
- The player has to build **two separate refinement branches**.
- One branch is 3 steps deep.
- The other branch is 2 steps deep.
- Then the player still needs the correct energetic conditions for the final reaction.

### 2. It uses all seven starters
- `Plant/Steel` branch uses: **Seed, Dirt, Fire, Iron**
- `Crystal` branch uses: **Water, Salt, Sand**
- That means reaching Gold implies broad mastery, not narrow brute force.

### 3. It respects the ancestor rule cleanly
- `Steel` ancestors: Seed, Dirt, Fire, Iron
- `Crystal` ancestors: Water, Salt, Sand
- The two final ingredients are fully disjoint, so the final transmutation remains legal.
- `Pressure` is a catalyst/byproduct system, so it can overlap without breaking the pair logic.

### 4. Pressure stays meaningful without becoming arbitrary
- Pressure is not “the answer” to one special recipe.
- It is a recurring energetic phenomenon the player learns to create and exploit.
- That makes the world feel more physical and less puzzle-boxy.

## Recommended hard-coded set

If you want the **smallest useful curated set**, hard-code these first:

1. `Water + Dirt -> Mud`
2. `Water + Fire -> Steam` (+ Heat)
3. `Seed + Dirt -> Plant`
4. `Plant + Fire -> Charcoal`
5. `Water + Salt -> Brine`
6. `Brine + Sand -> Crystal`
7. `Charcoal + Iron -> Steel`
8. `Steel + Crystal + Pressure -> Gold`

And separately, hard-code **Pressure emission rules** for classes of reactions rather than a single Pressure recipe.

That gives you:
- trustworthy onboarding,
- a longer and harder Gold path,
- meaningful metalworking,
- and Pressure as a real systemic force rather than a magic ingredient.

## Good candidates to leave to the LLM

After the milestones above are fixed, these can stay generative:

- weird side branches,
- cosmetic/fun compounds,
- nonessential plant derivatives,
- nonessential glass/mineral variants,
- off-path metal curiosities,
- “what if?” recipes players try for surprise.

That preserves novelty without making the core experience arbitrary.

## Extreme mode: The Great Work

If you really want Gold to feel **absurdly** difficult, stop treating it as a normal discovery and treat it as a authored endgame quest.

In that version, Gold is not just “one more mix.”
It is the end of a long transmutation ladder.

### Core idea

1. The player still learns the normal curated early game.
2. They then unlock a special transmutation reagent such as **Philosopher's Salt**.
3. From there, they must climb a long authored ladder through **every other element** from Iron to Lead.
4. Only then can Lead be turned into Gold.

### Suggested supporting reagents

These make the Great Work feel earned instead of arbitrary.

| Mix | Result | Purpose |
| --- | --- | --- |
| Water + Salt | Brine | mineral branch anchor |
| Brine + Sand | Crystal | refinement branch anchor |
| Seed + Dirt | Plant | organic branch anchor |
| Plant + Fire | Charcoal | metalworking / alchemy fuel |
| Crystal + Charcoal | Philosopher's Salt | universal transmutation reagent |
| Steel + Crystal + Heat + Pressure | Philosopher's Stone | final transmutation catalyst |

## The Lead ladder

A good “crazy hard” ladder is the **even-number chain** from Iron (26) to Lead (82):

`Iron -> Nickel -> Zinc -> Germanium -> Selenium -> Krypton -> Strontium -> Zirconium -> Molybdenum -> Ruthenium -> Palladium -> Cadmium -> Tin -> Tellurium -> Xenon -> Barium -> Cerium -> Neodymium -> Samarium -> Gadolinium -> Dysprosium -> Erbium -> Ytterbium -> Hafnium -> Tungsten -> Osmium -> Platinum -> Mercury -> Lead`

That is already an insane amount of authored progression while still having a clear structure.

### Recommended rule for the ladder

Do **not** hand-author 29 completely unrelated recipes.
Instead, hard-code a **ritual transmutation pattern**:

`Current Element + Philosopher's Salt + catalyst -> Next Element`

Where the catalyst cycles by region or block:
- **Heat** for most metal-to-metal upgrades
- **Pressure** for gas / volatile / unstable jumps
- **Crystal** for metalloid or structural jumps

That way the player learns a real system instead of memorizing nonsense.

### Example rhythm

- `Iron + Philosopher's Salt + Heat -> Nickel`
- `Nickel + Philosopher's Salt + Heat -> Zinc`
- `Zinc + Philosopher's Salt + Pressure -> Germanium`
- `Germanium + Philosopher's Salt + Pressure -> Selenium`
- `Selenium + Philosopher's Salt + Pressure -> Krypton`
- ...and so on until...
- `Platinum + Philosopher's Salt + Pressure -> Mercury`
- `Mercury + Philosopher's Salt + Heat -> Lead`

You can then reserve a few especially memorable gates:
- **Tin** as the first “you are really doing this” checkpoint
- **Mercury** as the near-final alchemical triumph
- **Lead** as the true penultimate state

## Final victory condition

Once the player reaches `Lead`, Gold should still not be immediate.

Recommended final step:

`Lead + Philosopher's Stone + Heat + Pressure -> Gold`

That means Gold requires:
- broad starter mastery,
- a long element ladder,
- a crafted reagent economy,
- and the ability to generate the right energetic conditions on the board.

That is genuinely wild.

## Why this version works

- It makes Gold feel like a **mythic achievement**, not a short craft tree.
- It gives the periodic table a real purpose instead of being hidden flavor text.
- It lets you keep the early game intuitive while making the late game almost obsessive.
- It turns the endgame into “The Great Work,” which fits the title extremely well.

## Practical implementation suggestion

If you go this route, I would recommend a two-layer system:

1. **Curated early game**
   - obvious recipes,
   - branch anchors,
   - consistent Heat behavior,
   - systemic Pressure emission.

2. **Authored Great Work endgame**
   - Philosopher's Salt,
   - the Iron-to-Lead ladder,
   - Philosopher's Stone,
   - Gold as the final transmutation.

This keeps the game learnable at first and gloriously unreasonable later.
