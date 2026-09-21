# Writing content invariants

What the test suite learned about checking a world full of authored content.
Most of this was bought with a mistake; the mistakes are named so they can be
recognised faster next time.

## The one rule

**Check the effect, not the presence.**

Every contract test for the side-quest system asserted that each quest's
`offer` and `reward.thanks` strings were non-empty. Both passed for weeks. Both
strings were displayed **nowhere** — a grep for either across the whole
renderer found nothing. The checks passed *precisely because the lines existed*
and nothing checked that they arrived.

Presence is cheap to test and nearly worthless on its own. "Is this string
non-empty" is a check on the author. "Does a screen read it" is a check on the
game. Prefer the second one, and where you cannot, say so out loud in the test's
name.

## Three ways to write a check that fails on good content

All three happened in one session, and each was fixed by narrowing the claim
rather than by fixing the content.

1. **Demanding style.** "Every arena's keeper names their own ground" failed on
   three maps in a row — the Wreck Marshal, the Guru of the Updrafts, the Lay
   Foreman. They talk about their schools and their union instead of the place.
   That is writing, not a bug. The rewritten check tests what actually breaks:
   the circuit and the map must *agree* on the arena's name, plus a blocklist
   of known aliases.
2. **Demanding place names everywhere.** Twenty-five of thirty-three givers
   never name the ground they stand on — and the quest card names it for them.
   A rule here would have fired on three quarters of good content.
3. **Demanding depth from everyone.** "Every on-map NPC must have a menu, a job
   or a joint" would flag a hauler waiting on weather and a watch who keeps the
   long light, both of which are exactly right.

## The register pattern

When a check *would* be over-strict but the fact is still worth knowing, make
it a **register** instead of a rule: an explicit, reasoned list that fails in
**both** directions.

```ts
const KNOWN = new Set(["ice_map/lamp-lighter", /* ...and why, one per line */]);
// a new one fails:  new walk-on(s) with nothing to do: rocky_map/new-placeholder
// a stale one fails: now interactive, so drop them from KNOWN: ...
```

Two-way failure is what makes it a register rather than an allowlist: the list
cannot rot into a lie, and adding to it is a decision somebody made rather than
a default.

## Walk the player's path

Data checks miss anything about the *journey*. Two signs had full dialogue and
passed every map-level check — and stood inside the border treeline, which
means **nobody could ever stand next to them and read them**. The sweep that
found them walked the clock in hundredths from each map's entrances and
required every on-duty keeper to be on a passable, reachable tile.

The version of this question worth asking is: *can the player do the thing
here at all?* Decor placement was checked tile-by-tile for years, and the
question nobody asked was whether **any spot existed** on a map with people on
it — the Salt Road had thirteen people and nowhere to set a bench down.

## Mutation-check every new invariant

An invariant that cannot fail is worse than none: it buys confidence it has not
earned. Before committing, break the thing on purpose and watch the test fail
by name.

```bash
cp src/renderer/world/maps.ts /tmp/maps.bak
# ...introduce the fault...
npx vitest run tests/world.test.ts     # must fail, with a message that says what broke
cp /tmp/maps.bak src/renderer/world/maps.ts
```

Things this caught, in one session: an alias reintroduced into a keeper's
greeting, a flag read with a typo (`met-axl`), a `goto:` landing in a treeline,
a purchasable item marked earned-only, a walk-on with nothing to say. Things it
also caught about the *tests*: two vacuous checks, and one that was over-strict.

## Let the message be the lesson

These tests fail in front of whoever breaks them, often months later, often
somebody who did not write the content. The failure text is the whole
instruction manual:

```
long_haul: the tile cook-ada left at 3,6 is still an invisible wall
these jobs do not say where: night-can: "wild beaten on the ice" (job at Drift Perimeter)
the_cut (The Cut) has 4 wild tiles and no terrain
```

Each one names the place, the thing and the consequence.

## Practical notes

- **Heavy checks need explicit timeouts.** The breeding guards measure a herd
  across five seeds and were silently failing on Vitest's five-second default.
  I nearly diagnosed that as a statistical flake and loosened a claim that was
  fine. If a test does real simulation, give it `, 60_000`.
- **Keep content invariants reading the shipped content**, not fixtures. The
  suite reads `maps.ts`, `decor.ts` and `side-quests.ts` directly, so adding
  content is what gets checked.
- **One tested helper beats several copies.** `shapeReadout`, `wildSendNote` and
  `questBeats` each render in more than one place; the phrasing cannot drift
  because there is only one phrasing.
- **A measured number is content too.** Several checks here pin *distributions*
  rather than specific scores — 53.6% of random cars fail tier II, the ice pack
  out-earns the yard after twenty meetings, the wild never collapses to one
  build. Tuning that flattens those curves fails the suite, which is the point.


## Documentation rots the same way

Two doc failures are worth catching mechanically, because both are invisible
until somebody follows a link, and both happen on an edit that looks harmless:

1. **A table of contents whose anchors no longer match the headings.** The
   notes log carries an index of seventy-six dated entries; renaming one
   heading kills one link silently. The test checks both directions — every
   anchor resolves to a heading, and every dated heading appears in the index —
   so the list can neither break nor go stale. (It had already gone stale by six
   entries before the check existed.)
2. **A cross-document link to a file that moved**, and an unclosed code fence,
   which swallows the rest of the page when the docs site renders it.

`tests/docs.test.ts` covers all three. Verified by mutation: renaming an
indexed heading fails with `the notes index points at headings that are gone:
the-mechanic-with-no-teacher-2026-09-15`.
