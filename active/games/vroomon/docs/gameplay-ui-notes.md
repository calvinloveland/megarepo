# Vroomon gameplay & UI notes (2026-09-10)

Companion to `docs/audit.md`. Covers the gameplay/UI pass: how we reviewed the
rendered app, what we found, what we fixed, and reusable recipes (vision
sub-agents, OCR, pixel probes) for future sessions.

## HUD widths — verified, no change needed (2026-09-15) ✅

The WILD chip grew a second fact (`gen 13 · sends 200`) and the CIRCUIT chip a
tier bar, so the top-left panel was worth re-measuring. Measured, not eyeballed:
at **1280×800** and **1024×768** the panel holds its 300px, no element reports
`scrollWidth > clientWidth`, and the longest chip still reads on one line —

```
MAP The Ranch Yard · HOUSES 0 · BRANDS 0/5 · HERD 0 specimens
WALLET 0 cr · SEEKING ON 🔍 · WILD gen 13 · sends 200
```

(Captures: `/tmp/vshots/84-hud-1280.png`, `84-hud-1024.png`.)

The CIRCUIT chip is not in this list because it lives on the **herd** panel
rather than in the world HUD; while walking, the circuit appears in the quest
card instead. Both were checked, and neither crowds.

### One thing the screenshot nearly cost me

At 1024px the grass prop's label reads "Tail Grass" and I had the edit open —
but `maps.ts` says `name: "Tall Grass"`, and the source is right: it is a
two-pixel font at that scale, not a typo. Checking the source before "fixing"
the screenshot is the fourth time this session that verifying beat fixing.

---

## A full sitting, played from nothing (2026-09-15) ✅

Everything this session changed meets in the opening hour, so I played it
through with an empty save rather than trusting the pieces: title, monologue,
name, wake, Robby in the kitchen, the yard hand-off, the first catch, three
generations, the Record Barn, the Elder, the first Brand — then a seeded climb
to the Grand Roundup.

```
name step        WHAT SHOULD MY NEW NAME BE?
wake             Sunlight through the cabin shutters…
quest            Robby's in the kitchen — follow the call.
kitchen          Rancher Robby
first catch      The Ranch Yard · Grassland stock · the founders · best 479px
                 Beaten by 348px — its genome is in your Herd Book.
after praise     The garden gate opens onto town.
herd best        preview-…-00127 · 1344.56
briefing         Grassland I. The bar is 1000 and your barn holds 1345.
                 This one is yours to lose.
tier I           FEUD RACE · I | Rival took second at 940.
brand line       Rustler Pasture I swept! The circuit moves to II — bar 1220.
roundup          🏆 The five Brands are yours, and your champion stands in the
                 Record Barn.
```

Nothing read stale, and three of this session's changes show up exactly where
they were meant to: the catch panel names the ground and its stock, the Wild
chip is absent in the yard until you meet something, and the Elder says the bar
and your best in one breath before the race card appears.

Captures: `/tmp/vshots/sit-0{1..7}-*.png`.

**One note for the next pass:** the first catch was won by 348px with the
loaner, which is comfortable — but the ground's own best is 479px, so a player
who hunts first and then breeds has a slightly stronger starting animal than
the loaner. That is the intended shape (the gift is a floor, not a ceiling) and
it is worth re-checking only if the ladder ever gets harder.

---

## The mechanic with no teacher (2026-09-15) ✅

Weather is a rule the game enforces — wet grass costs grip, and a feud's bar is
raised while you stand in the rain — and for its whole life the only place it
was explained was a **note on a panel**. A player met it as a number.

Now the road's own people read the sky. Signal Lorn, who keeps the lamps on the
Highland switchback, has a line about the crosswind: *"Read it before you run,
not after. A crosswind off the ridge and power counts for less — you will feel
it as the car refusing. Mist hides the line before it slows you. Rain is the
worst of them: wet grass is grip you did not bring, and a race in it is run
against a bar the weather raised. Dry day, dry numbers."* Watchman Pell keeps
the weather book on the Long Haul: *"Clear means the numbers you bred for.
Shower, and the whole road turns to grease…"*

The contract is a test: **every kind of weather must be named by somebody in the
world.** Replacing the words with synonyms fails it by name
(`nobody explains: gale`), so a fifth sky cannot be added without someone to
speak for it.

### The cost of editing a menu

Adding an option to Lorn and Pell broke two e2e tests that clicked
`[data-dialogue-option]` **by index** — the job line moved from position 2 to 3
and their assertions about a different option went looking in the wrong place.
Both now choose by label through a `clickDialogueOption(page, /I'll work the
dark/)` helper that throws with the actual menu when it cannot find a match.

Two lessons from one edit: **menus grow**, so anything positional in a test is a
future failure; and a test that breaks when an *unrelated* option is added was
asserting the wrong thing all along.

---

## Every panel measured at 1024×768 (2026-09-15) ✅

Same approach as the HUD pass: measure `scrollWidth > clientWidth` on every
visible box rather than trusting an eye, at 1024×768 (a 13" laptop).

```
pocket-ranch herd       fits
pocket-ranch drive      fits
pocket-ranch barn       fits
pocket-ranch heritage   fits      (canvas scales; node labels shrink with it)
pocket-ranch market     fits
pocket-ranch dex        fits
inspector               fits
```

No overflow anywhere, and the scene bar keeps all six pills plus "Back to the
road" on one line. The one thing measurement cannot judge is legibility: the
Heritage canvas is a fixed 1200px drawing scaled into ~940px, so its node labels
get smaller on a narrow screen. Worth watching if labels are ever added there,
but nothing is clipped.

### And the screenshot caught a real one

`0 vroomon · 0 champions · **1 generations deep**` — an empty graph is not one
generation deep, and "1 generations" grates. The line says **"no lines yet —
breed a generation"** when there is nothing to draw, and pluralises properly
once there is (`150 vroomon · 12 champions · 12 generations deep`).

That is the third bug this session found by looking at a rendered screen rather
than at a data structure — after two signs built inside a treeline and a wild
encounter raced on the wrong ground.

---

## The loaner is pitched exactly right, so it stays (2026-09-15) ✅

The full sitting flagged a question worth answering with numbers: the first
catch was won by 348px, but the yard's wild champion runs 479px against the
loaner's 463 — so the *gift* is slightly below the best thing in the grass
beside the house. Should the starter be stronger?

Measured, the whole founder pack:

```
yard pack (founders)   min 3   p25 74   median 136   p75 206   champion 479
loaner on Grassland    463
```

**The answer is to change nothing.** The loaner beats the ground's middle
animal by more than three times, so the tutorial's first catch — the game's
first real test — is a comfortable win. It loses to the ground's champion by
**16px, or 3%**: close enough that the player can see a slightly better animal
exists and nothing more is needed from them, far enough that walking into the
grass has a point. A starter far behind the local wild would read as a
punishment; one ahead of everything would make hunting pointless on day one.

`tests/early-game.test.ts` pins all three relationships now — better than twice
the median, behind the champion, within a fifth of it.

**And a note on what that test actually guards**, because mutation-checking it
was instructive: founder packs are *seeded deterministically*, so raising the
wild's mutation rate does not move these numbers at all. What moves them is the
loaner's DNA, the sim's scoring, the pack size and the founding seed — which is
precisely the set of things that can break the first morning, and precisely
what the contract is for.

---

## Nineteen option clicks, none of them positional (2026-09-15) ✅

Adding two lines to two keepers' menus broke two unrelated tests last cycle,
because they clicked `[data-dialogue-option]` **by index**. The suite had
nineteen of those. All nineteen now name what they are choosing:

```ts
const FEUD_OPTION = /race.*feud|settle the feud/i;
await clickDialogueOption(page, FEUD_OPTION);
```

The helper throws with the actual menu when it cannot match
(`no dialogue option matching /night shift/i: What gets left on it? | …`),
which turned out to be the useful part: **three of the nineteen patterns I
guessed were wrong**, and the failure told me the real label each time. It is
now impossible for a menu that grows to take an unrelated test down with it.

### Two mistakes worth naming, both positional

- **The bulk swap was positional too.** Replacing every `nth(2)` with
  `FEUD_OPTION` hit five sites — four feuds and one schoolchild's third option —
  and I only noticed because the test failed. A bulk edit needs the same care as
  an index: verify each site, not each pattern.
- **Line-number edits drifted.** I patched a second pattern by line number after
  an earlier edit had shifted the file, and fixed one line that was already
  right while leaving another pointing at the wrong conversation. Anchoring on
  stable text (`Storekeep Bram` → the next click) is the fix, and it is the same
  reason the option clicks now use labels.

---

## Notes dated 2026-09-15, in file order

A table of contents for this date's work, which is scattered through the file
because each entry lands beside whatever it followed at the time. Everything
below the list is older. The docs test requires this list to be complete, so a
new entry that is not indexed here fails the suite.

<!-- session-index:start -->
- [HUD widths — verified, no change needed (2026-09-15) ✅](#hud-widths-verified-no-change-needed-2026-09-15)
- [A full sitting, played from nothing (2026-09-15) ✅](#a-full-sitting-played-from-nothing-2026-09-15)
- [The mechanic with no teacher (2026-09-15) ✅](#the-mechanic-with-no-teacher-2026-09-15)
- [Every panel measured at 1024×768 (2026-09-15) ✅](#every-panel-measured-at-1024768-2026-09-15)
- [The loaner is pitched exactly right, so it stays (2026-09-15) ✅](#the-loaner-is-pitched-exactly-right-so-it-stays-2026-09-15)
- [Nineteen option clicks, none of them positional (2026-09-15) ✅](#nineteen-option-clicks-none-of-them-positional-2026-09-15)
- [Notes dated 2026-09-15, in file order](#notes-dated-2026-09-15-in-file-order)
- [The Heritage tree draws at the size it is shown (2026-09-15) ✅](#the-heritage-tree-draws-at-the-size-it-is-shown-2026-09-15)
- [Every drawing surface now fits its box (2026-09-15) ✅](#every-drawing-surface-now-fits-its-box-2026-09-15)
- [The world was stretched to fit the window (2026-09-15) ✅](#the-world-was-stretched-to-fit-the-window-2026-09-15)
- [Two modules nobody tested, and a map to catch the next (2026-09-15) ✅](#two-modules-nobody-tested-and-a-map-to-catch-the-next-2026-09-15)
- [Where this session left the project (2026-09-15) ✅](#where-this-session-left-the-project-2026-09-15)
- [The last rule with no teacher: what the wild is *for* (2026-09-15) ✅](#the-last-rule-with-no-teacher-what-the-wild-is-for-2026-09-15)
- [Six wrong assumptions in one test file (2026-09-15) ✅](#six-wrong-assumptions-in-one-test-file-2026-09-15)
- [The wild table answers the question you came in with (2026-09-15) ✅](#the-wild-table-answers-the-question-you-came-in-with-2026-09-15)
- [The ledger said DEFEND, and nobody said why (2026-09-15) ✅](#the-ledger-said-defend-and-nobody-said-why-2026-09-15)
- [The sprite export had drifted, and nothing could have noticed (2026-09-15) ✅](#the-sprite-export-had-drifted-and-nothing-could-have-noticed-2026-09-15)
- [Named but never called: seven helpers with rules in them (2026-09-15) ✅](#named-but-never-called-seven-helpers-with-rules-in-them-2026-09-15)
- [The HUD chips: audited, and already covered (2026-09-15) ✅](#the-hud-chips-audited-and-already-covered-2026-09-15)
- [The baked tile layer was fine, and one function was dead (2026-09-15) ✅](#the-baked-tile-layer-was-fine-and-one-function-was-dead-2026-09-15)
- [The design overview had drifted, and the invariants outgrew it (2026-09-15) ✅](#the-design-overview-had-drifted-and-the-invariants-outgrew-it-2026-09-15)
- [Four buttons that did not say what they do (2026-09-15) ✅](#four-buttons-that-did-not-say-what-they-do-2026-09-15)
- [Three ways a written scene quietly stops working (2026-09-15) ✅](#three-ways-a-written-scene-quietly-stops-working-2026-09-15)
- [Where people are, and where the map file says they are (2026-09-15) ✅](#where-people-are-and-where-the-map-file-says-they-are-2026-09-15)
- [The inverse sweep: flavour that could belong to any map (2026-09-15) ✅](#the-inverse-sweep-flavour-that-could-belong-to-any-map-2026-09-15)
- ["Is it worth a walk?" answered where the car is (2026-09-15) ✅](#is-it-worth-a-walk-answered-where-the-car-is-2026-09-15)
- [You can decorate anywhere people live (2026-09-15) ✅](#you-can-decorate-anywhere-people-live-2026-09-15)
- [A ledger of walk-ons (2026-09-15) ✅](#a-ledger-of-walk-ons-2026-09-15)
- [The wild's number, next to the human one (2026-09-15) ✅](#the-wilds-number-next-to-the-human-one-2026-09-15)
- [A sweep for scenery, and the pupil who teaches (2026-09-15) ✅](#a-sweep-for-scenery-and-the-pupil-who-teaches-2026-09-15)
- [Where you hunt matters, on a screen (2026-09-15) ✅](#where-you-hunt-matters-on-a-screen-2026-09-15)
- [The local-giver pattern, as an e2e (2026-09-15) ✅](#the-local-giver-pattern-as-an-e2e-2026-09-15)
- [Is hunting a shortcut past the bench? Measured (2026-09-15) ✅](#is-hunting-a-shortcut-past-the-bench-measured-2026-09-15)
- [The people standing on a ground give its work (2026-09-15) ✅](#the-people-standing-on-a-ground-give-its-work-2026-09-15)
- [Six biomes, six animals — measured (2026-09-15) ✅](#six-biomes-six-animals-measured-2026-09-15)
- [The same verdict wherever a car is described (2026-09-15) ✅](#the-same-verdict-wherever-a-car-is-described-2026-09-15)
- [Hunting on the high road bred Grassland stock (2026-09-15) ✅](#hunting-on-the-high-road-bred-grassland-stock-2026-09-15)
- [Does the wild answer the shapes? Measured (2026-09-15) ✅](#does-the-wild-answer-the-shapes-measured-2026-09-15)
- [The Inspector answers the ground (2026-09-15) ✅](#the-inspector-answers-the-ground-2026-09-15)
- [One field, one name (2026-09-15) ✅](#one-field-one-name-2026-09-15)
- [The panel says what your best is (2026-09-15) ✅](#the-panel-says-what-your-best-is-2026-09-15)
- [From tier II the ground asks what your car is made of (2026-09-15) ✅](#from-tier-ii-the-ground-asks-what-your-car-is-made-of-2026-09-15)
- [The ground says what it wants (2026-09-15) ✅](#the-ground-says-what-it-wants-2026-09-15)
- [Nothing the writer wrote goes unread (2026-09-15) ✅](#nothing-the-writer-wrote-goes-unread-2026-09-15)
- [Earned-only decor, and a button that says what it will do (2026-09-15) ✅](#earned-only-decor-and-a-button-that-says-what-it-will-do-2026-09-15)
- [The writers' lines were never on screen (2026-09-15) ✅](#the-writers-lines-were-never-on-screen-2026-09-15)
- [A correction: where the ladder actually starts asking (2026-09-15) ✅](#a-correction-where-the-ladder-actually-starts-asking-2026-09-15)
- [The middle of the circuit, measured (2026-09-15) ✅](#the-middle-of-the-circuit-measured-2026-09-15)
- [The early game, measured (2026-09-15) ✅](#the-early-game-measured-2026-09-15)
- [A car's family, one tap from its parts (2026-09-15) ✅](#a-cars-family-one-tap-from-its-parts-2026-09-15)
- [Two invariant sweeps, and the two signs they caught (2026-09-15) ✅](#two-invariant-sweeps-and-the-two-signs-they-caught-2026-09-15)
- [A second pass along the arc (2026-09-15) ✅](#a-second-pass-along-the-arc-2026-09-15)
- [One car, read in the context of its family (2026-09-15) ✅](#one-car-read-in-the-context-of-its-family-2026-09-15)
- [A fresh-playthrough pass (2026-09-15) ✅](#a-fresh-playthrough-pass-2026-09-15)
- [Rain is a defence modifier, not a fitness change (2026-09-15) ✅](#rain-is-a-defence-modifier-not-a-fitness-change-2026-09-15)
- [The Heritage tree reads like a pedigree (2026-09-15) ✅](#the-heritage-tree-reads-like-a-pedigree-2026-09-15)
- [Grass you cannot walk to is a mechanic that does not exist (2026-09-15) ✅](#grass-you-cannot-walk-to-is-a-mechanic-that-does-not-exist-2026-09-15)
- [Every far road has someone on after dark (2026-09-15) ✅](#every-far-road-has-someone-on-after-dark-2026-09-15)
- [Weather, and where it is allowed to matter (2026-09-15) ✅](#weather-and-where-it-is-allowed-to-matter-2026-09-15)
- [The ledger is a work list, not a report (2026-09-15) ✅](#the-ledger-is-a-work-list-not-a-report-2026-09-15)
- [Every arena has a back room (2026-09-15) ✅](#every-arena-has-a-back-room-2026-09-15)
- [Jobs have to be possible where they are handed out (2026-09-15) ✅](#jobs-have-to-be-possible-where-they-are-handed-out-2026-09-15)
- [The ledger: bars against bests (2026-09-15) ✅](#the-ledger-bars-against-bests-2026-09-15)
- [The watchman was right about the dark (2026-09-15) ✅](#the-watchman-was-right-about-the-dark-2026-09-15)
- [The road landmarks have offices (2026-09-15) ✅](#the-road-landmarks-have-offices-2026-09-15)
- [The campaign spine was six generations long (2026-09-15) ✅](#the-campaign-spine-was-six-generations-long-2026-09-15)
- [Three invariants that reached across systems (2026-09-15) ✅](#three-invariants-that-reached-across-systems-2026-09-15)
- [Night changes who is about (2026-09-15) ✅](#night-changes-who-is-about-2026-09-15)
- [Beauty pass 3: rooms lit, a square furnished (2026-09-15) ✅](#beauty-pass-3-rooms-lit-a-square-furnished-2026-09-15)
- [A pacing audit, measured (2026-09-15) ✅](#a-pacing-audit-measured-2026-09-15)
- [Starter Town has rooms now (2026-09-15) ✅](#starter-town-has-rooms-now-2026-09-15)
- [People have days, and memories (2026-09-15) ✅](#people-have-days-and-memories-2026-09-15)
- [The save audit now covers every store (2026-09-15) ✅](#the-save-audit-now-covers-every-store-2026-09-15)
- [A landmark for every far road (2026-09-15) ✅](#a-landmark-for-every-far-road-2026-09-15)
- [Rooms behind the waystation's doors (2026-09-15) ✅](#rooms-behind-the-waystations-doors-2026-09-15)
- [The Long Haul: a road stop, and five unreachable doors (2026-09-15) ✅](#the-long-haul-a-road-stop-and-five-unreachable-doors-2026-09-15)
- [A save audit, and the herd it saved (2026-09-15) ✅](#a-save-audit-and-the-herd-it-saved-2026-09-15)
- [Beauty pass 2: the world keeps time and remembers feet (2026-09-15) ✅](#beauty-pass-2-the-world-keeps-time-and-remembers-feet-2026-09-15)
- [The Herd Book keeps notes (2026-09-15) ✅](#the-herd-book-keeps-notes-2026-09-15)
- [Quest contracts: the content is now checked, not trusted (2026-09-15) ✅](#quest-contracts-the-content-is-now-checked-not-trusted-2026-09-15)
- [Jobs that chain, and a reason to ride out (2026-09-15) ✅](#jobs-that-chain-and-a-reason-to-ride-out-2026-09-15)
- [Ambient life, and water that moves (2026-09-15) ✅](#ambient-life-and-water-that-moves-2026-09-15)
- [Oxide's trade counter: the herd book pays (2026-09-15) ✅](#oxides-trade-counter-the-herd-book-pays-2026-09-15)
- [Marrow Orchard: a new area with its own people (2026-09-15) ✅](#marrow-orchard-a-new-area-with-its-own-people-2026-09-15)
- [Side quests, and the world-save bug they flushed out (2026-09-15) ✅](#side-quests-and-the-world-save-bug-they-flushed-out-2026-09-15)
- [The wild evolves too, with nobody in charge (2026-09-15) ✅](#the-wild-evolves-too-with-nobody-in-charge-2026-09-15)
- [Indoors and outdoors are separate places (2026-09-15) ✅](#indoors-and-outdoors-are-separate-places-2026-09-15)
- [Hunting is your choice, and catching means racing (2026-09-15) ✅](#hunting-is-your-choice-and-catching-means-racing-2026-09-15)
- [Breeding was not actually working (2026-09-15) ✅](#breeding-was-not-actually-working-2026-09-15)
- [The vroomon inspector (2026-09-15) ✅](#the-vroomon-inspector-2026-09-15)
- [Parts meet: no daylight in the frame (2026-09-15) ✅](#parts-meet-no-daylight-in-the-frame-2026-09-15)
- [The vroomon body: one rigid frame, driven at the wheels (2026-09-15) ✅](#the-vroomon-body-one-rigid-frame-driven-at-the-wheels-2026-09-15)
<!-- session-index:end -->

---

## The Heritage tree draws at the size it is shown (2026-09-15) ✅

The canvas was a fixed **1200×620** scaled down by CSS. At a 1024px window it
was displayed at 948px wide, so every label — node names, scores, the generation
ruler — drew at 79% of its designed size, and the 13px labels arrived at about
10px. Legible in a screenshot at 1440px; a squint at 1024px. It sizes its
backing store to the box it is actually drawn into now, and matches the
stylesheet's `max-height: 62vh` so the CSS cannot squash the drawing.

## Every drawing surface now fits its box (2026-09-15) ✅

The Heritage tree was not the only canvas authored at a fixed size and scaled by
CSS. The Inspector's tracks were designed at 640×240 and the wild race lanes at
720×260, and both were arriving at **79%** of their designed size in a 1024px
window — the same shrinking labels, on two more surfaces.

The arithmetic is one tested function now. `fittedCanvasSize` takes the box the
canvas is displayed in, the aspect it was designed for, a floor, a ceiling and
an optional height clamp, and returns the backing size; `fitCanvasToBox` applies
it. Pure maths, five unit tests — including the case that caught my own wrong
assumption, that a floor *raises* a small box and never lowers a large one.

```
                designed    at 1024px before    now
wild lanes      720x260     704x254 (98%)       704x254 backing = shown
inspector       640x240     506x190 (79%)       506x190 backing = shown
heritage tree  1200x620     948x474 (79%)       948x476 backing = shown
```

---

## The world was stretched to fit the window (2026-09-15) ✅

The overworld canvas is authored **640×480** — 4:3, sixteen 40px tiles across —
and the CSS stretched it to fill its panel, which is whatever shape the window
is. Measured at three sizes:

```
1024x768    panel 4:3      stretch 1.000x   tiles 64x64
1440x900    panel 1.6:1    stretch 1.200x   tiles 90x75
1920x1080   panel 16:9     stretch 1.334x   tiles 107x80
```

At 1080p every tile was **33% wider than tall**, and so was every vroomon,
every tree and every house. It reads as a slightly wide art style until you
measure it, which is why it survived a dozen screenshot passes.

`object-fit: contain` on the canvas keeps the drawing at its own aspect and
letterboxes the rest, with the surround set to the deep-forest colour so the
bars read as trees rather than as a layout bug. Verified by the same
arithmetic, now square:

```
1600x900 panel -> drawing 1200x900, tiles 75.0 x 75.0
```

---

## Two modules nobody tested, and a map to catch the next (2026-09-15) ✅

Asking which source modules have no test naming them turned up nine, and two of
them were pure logic sitting under thoroughly tested neighbours:

- **`src/shared/frame.ts`** — the frame geometry and plant costs that the
  physics *and* the Inspector both read. Covered transitively through the
  blueprint, never directly, which is why nobody noticed the missing tests.
- **`src/renderer/world/factions.ts`** — the rival households: two per biome,
  joined by a dialogue flag, remembered in the save.

Both have direct tests now (11 between them), and writing them was instructive
in the usual way: my first drafts called `framePlant(decoded)` with one argument
when it needs weights, asserted `hullCost <= 1` when the code deliberately
allows 1.5, hand-wrote a DNA string expecting it to decode literally (base62
does not), and seeded a herd with a *constant* RNG and then asked why every car
was identical. Four wrong assumptions, all caught by running it.

`tests/coverage-map.test.ts` keeps the map: every module under `src/` must be
named by some test, or listed with a reason — the seven that legitimately are
not are Electron entry points, the preload bridge, a re-export shim, WebAudio,
the sprite loader, the app shell and the Playwright shim, each covered by the
e2e or smoke run instead. It fails **both** ways, like the walk-on ledger: an
unlisted untested module, and a listed module that has since gained a test.
Both directions verified by mutation.

---

## Where this session left the project (2026-09-15) ✅

**420 unit + 55 e2e pass**, both re-run twice for the wrap; tree clean; local
server rebuilt on the latest bundle. Around eighty-five commits, all of them
`Vroomon:`-prefixed, each a single logical unit.

### The state of play

- **The sim** — two-path bodies on one rigid compound chassis, wheels pinned at
  their centres, drive applied at each driven wheel. Breeding is local
  (one-parameter mutation), the herd climbs, and the guards that measure it
  have explicit timeouts.
- **The wild** — packs of 24 per ground, evolving on their own terrain between
  visits, elite-carrying, with immigrants keeping the builds varied. Encounters
  send the median animal.
- **The circuit** — five Brands on their own ground, bars climbing ×1.22, and
  from tier II a **shape** demand as well as a score. The keeper states both
  before the race card appears.
- **The world** — Starter Town and its rooms, two roads, three arenas with back
  rooms, the Mesa, the Quarry, the Perimeter, the Long Haul, the Orchard and
  the ranch; twelve rival houses; keepers, night watches, landmarks and
  workings; weather with a teacher; and a day that moves people around.
- **The loop on screen** — the herd bench, the Inspector (parts, tracks, live
  race, pedigree, circuit shape), the Heritage tree, the Record Barn with its
  ledger, records and wild-grounds table, Oxide's counter and the Herd Book.

### What the session was actually about

Not features. Almost every cycle ended up finding something by **measuring**
what looked fine: two signs built inside a treeline, an encounter raced on the
wrong ground, three hunting grounds breeding the wrong biome's stock, a world
stretched 33% wider than tall, labels at 79% of their size, a reward line with
no screen, an "earned" decoration nothing granted, a flag nothing ever set.
Screenshots catch wrongness only if you already know the right answer;
arithmetic catches it every time. The two together did the work.

The other half was **invariants that fail in both directions** — registers
rather than rules. A walk-on with nothing to say, a module with no test, a docs
entry missing from the index, a listed module that has since gained one: each
of those lists is checked for staleness as well as completeness, so it cannot
rot into a lie. Three of them caught the very next thing written after them.

And the recurring mistake, worth naming plainly because it happened four times:
**an edit that identifies its target by position will eventually hit the wrong
thing.** Option indexes in tests, a bulk `nth(2)` swap, line-number edits, and a
script that regenerated a docs index by replacing everything up to a heading.
Every one was fixed by anchoring on stable text or explicit markers instead.

### Next session

1. **Breadth on the deep systems** — the wild, the circuit and the quest ledger
   have each grown three features deep; their UI should say what each is *for*.
2. **Make the coverage map's reasons specific** — which behaviour covers each
   listed-untested module.
3. **Hunt more logic hiding under tested neighbours**, the way `frame.ts` and
   `factions.ts` were.
4. **The user-gated work**: live deploy (k3s + Cloudflare) and AI sprite
   generation both still wait on credentials in `.secrets/`.

---

## The last rule with no teacher: what the wild is *for* (2026-09-15) ✅

Weather got a teacher two cycles ago. Auditing the other mechanics for the same
gap — a rule the game enforces that only a HUD chip states — left one, and it
was the most important in the game:

**Nothing said when to go hunting, or why.** The wild table says what each
ground would send, and the encounter panel says where an animal came from, but
no person ever connected the grass to the bench. A player could spend a whole
session breeding a plateaued herd and never learn that the answer was a walk.

Professor Axle — who already teaches the bench and the Record Barn — now
answers the question directly, as a fourth item on his menu:

> **"When do I go looking in the grass?"** — *"When the bench stops giving you
> anything. A herd bred from itself flattens out — you will see the same numbers
> three generations running, and no amount of patience moves them. That is the
> moment to walk into the grass. The wild has been breeding without you, on its
> own ground, and what it is worth depends entirely on where you stand: the far
> grounds send better animals than the field behind your house. Bring one back,
> put it on the bench, and the whole line lifts."*

That is the plateau measurement, the "where you hunt matters" finding and the
import mechanic, in one paragraph from the person whose job it is.

### The contract, consolidated

The weather check became a table of **rules the HUD states and a person must
teach**: four kinds of weather, the wild's purpose, where-you-hunt-matters, and
the tier's shape demand. Mutation-verified — replacing Axle's words with
synonyms fails with `nobody explains: the wild's purpose`.

Also visible in the screenshot: the schoolhouse renders with **square tiles**,
which is the letterbox fix from the previous cycle doing its work indoors.

---

## Six wrong assumptions in one test file (2026-09-15) ✅

Following the coverage map inward — from "no test names this module" to "no
test asserts on this export" — turned up 46 unreferenced exports. Most are
legitimately covered by the e2e or by their callers, but four groups are real
contracts with things outside the app, and had never been asserted on:

- **The generation log** round-trips (`serializeGenerationLogEntry` /
  `parseGenerationLogEntry`), keeps a null best, and writes one line per entry.
- **The DNA alphabet** accepts exactly base62, one character at a time.
- **The rival score curve** (`inverseNormalCdf`) is centred, symmetric, monotone
  and clamped at the ends.
- **The file paths** all live inside one `vroomon` directory, with distinct
  names per file and per run.

Writing those tests took six attempts, because I wrote them from memory rather
than from the code:

```
base62Value("a")                 I expected 10   it is 36   (digits, UPPER, lower)
inverseNormalCdf(0.5)            expected 0      correct
hullCost <= 1                    it may reach 1.5, deliberately
framePlant(decoded)              needs weights as a second argument
getGenerationLogPath(base)       needs a run id; without one, "undefined.jsonl"
paths end with ".json"           the generation log is ".jsonl"
```

Every one was caught by running the test rather than by reading it. The alphabet
order is the one worth keeping: anybody hand-typing a DNA string depends on
`0-9A-Za-z` exactly, and I had assumed the other way round.

---

## The wild table answers the question you came in with (2026-09-15) ✅

The table says what each pack would send. That is a fact; the question a player
opens the barn with is *"does any of it clear the bar in front of me?"* A line
under the table answers it now, for the circuit you are actually on:

```
FOR GRASSLAND II · 1220   Nothing met sends 1220 for Grassland II yet; the
                          best is The Ranch Yard at 247.
```

Three cases, all unit-tested: a ground that clears the bar (`Drift Perimeter
sends 1622 — that clears Ice II (1220). Worth the walk.`), grounds met but none
enough (`Nothing met sends 2400 for Ice V yet; the best is …`), and a terrain
with no reading at all (`No pack met on Hills yet`).

Two small DRY fixes came out of writing it. My first draft carried a private
`romanFor` — a second copy of the numerals the circuit already has — and printed
the tier as a bare `2` in the header while the sentence beside it said `II`.
Both now use `tierLabel`, so the header and the sentence cannot disagree about
what tier it is.

---

## The ledger said DEFEND, and nobody said why (2026-09-15) ✅

The Record Barn's ledger carries the most interesting row in the game:

```
DEFEND   1 circuit would turn your best away
```

A title is defended at a raised bar — you beat 1000, so the ground answers 1220
— and that is the whole shape of the campaign after the first Brand. It was
*stated* in a row and in the sweep message, and **explained nowhere.**

The Meadow Elder now answers it, as a fourth item on his menu — he is the one
who hands out feuds, so he is the one who should say what a Brand is:

> **"Why does the bar go up?"** — *"Because a Brand is a promise, not a prize.
> You beat a thousand, so the ground answers twelve hundred — every house that
> wants it has to come through you, at the number you set. Sweep it again and it
> climbs again. That is what a title is: a bar somebody else has to clear. The
> ledger in the Record Barn keeps the count of what it would cost you now."*

The teaching contract grew a row for it, mutation-verified like the others
(`nobody explains: a title is defended at a higher bar`).

### And the sweep from two cycles ago paid for itself

Adding a fourth option to a menu that five e2e tests click through **broke
nothing.** Before the label-based sweep, that edit would have shifted an index
and taken unrelated tests down — it happened twice, which is why the sweep
happened. This is the first content edit since where the old failure mode was
simply absent.

---

## The sprite export had drifted, and nothing could have noticed (2026-09-15) ✅

The runtime prefers the exported PNGs over drawing anything itself — that is
what makes them replaceable with real art — and it also means a stale export is
**invisible**. Change the drawing code, forget to re-export, and the game
quietly keeps showing the old pictures. The notes said "must re-export after
changing drawing code" and nothing checked it.

Asked the pipeline the question directly by running it:

```
committed manifest   158 sprites
fresh export         268 sprites   (111 new, 63 changed)
```

**Sixty-three sprites were showing stale art** — same dimensions, different
bytes, so genuinely different pictures rather than encoding noise — and 111
more were absent from the manifest entirely, meaning they were being drawn at
runtime every frame instead of loaded. That is the same class of drift as the
canvases: a thing that looks fine and is a version behind.

### The fix is a stamp

The exporter now writes `source-hash.json`: a SHA-256 of the art sources
(`sprites.ts`, `sprites-palette.ts`, `portraits.ts`) alongside the manifest.
`tests/sprite-export.test.ts` recomputes it and fails with *"the sprite drawing
code has changed since the last export — run `npm run export:sprites`"*. The
re-export is committed with it, so the tree is consistent and the drift cannot
recur silently.

The check also verifies that every `drawn` entry in the manifest has its PNG
beside it, which is the half that catches the 111.

---

## Named but never called: seven helpers with rules in them (2026-09-15) ✅

The coverage map answers "is this module named by a test". The next question
inward is sharper: **is this function ever actually called by one?** Of 29
exports named but never called, most are legitimately indirect — renderers
driven through the e2e, state setters used everywhere in the app — but seven
carry rules that nothing asserted:

- **`seedGenealogy`** — every car in a new herd starts parentless, which is
  what makes "founder stock" honest in the Heritage tree.
- **`badgeForMap`** — the circuit's key. A map with no entry quietly becomes a
  Grassland feud, so the fallback is worth stating.
- **`windowLight`** — out by day, lit at night, and *faded* through dusk rather
  than switched.
- **`thanksSpokenKey`** — the renderer writes it, `questBeats` reads it. If the
  two ever disagreed, a giver would repeat themselves forever or never speak.
- **`addTally` / `markVisited`** — pure state, and `markVisited` counts once
  however often you cross the map, which is what stops a "walk there" quest
  finishing on the way home.
- **`advanceDialogue`** — a flagged beat that chains onward applies its flag on
  the way through. That is the rule the reveal beat depends on.
- **`npcOnTile` / `findAdjacentNpc`** — who is standing where *now* (routine
  aware), and that talking requires the player to face them.

Seven tests, each placed in the file it belongs to rather than a grab-bag, and
one of them found the `advanceDialogue` rule was documented in a comment and
nowhere else.

---

## The HUD chips: audited, and already covered (2026-09-15) ✅

Last of the mechanic audits — does every chip say what it is *for*, or only what
it *is*? Chip by chip, the rule behind each is already in somebody's mouth:

| chip | who explains it |
| --- | --- |
| SEEKING | Robby's first lesson, and the toggle he hands you |
| HERD / specimens | Axle, on the Herd Book |
| WILD | Axle's new answer about when to walk into the grass |
| BRANDS / CIRCUIT | the Meadow Elder, before every feud |
| WALLET / FEED / RANCH | the fitters' yard, in one breath |
| HOUSES | the Elders' invitation, and what a house is for |

The economy one is worth quoting, because it was already there and I had
forgotten it existed:

> *"First time in town? The Ranch fitters' yard is just east of me — wire in
> pasture for herd room, stalls for barn slots, and a one-shot tonic to calm a
> nervous breeding night. Every carrier runs on grain: breeding costs a feed a
> generation, and releasing the slow pays it back. Credits come from every lap
> the Barn pays out, so race often."*

**Four rules in one paragraph**: what upgrades do, that feed is the breeding
cost, that releasing returns it, and where credits come from.

So the audit found nothing to fix — and the useful thing to do with a clean
audit is to make it permanent. Those four rules joined the teaching contract,
mutation-verified: deleting the sentence fails with `nobody explains: feed costs
a generation, releasing pays feed back, credits come from racing`.

Three audits this session have now ended in "already covered" (the walk-ons,
Fitter Aubrey and the Cut's givers, and this one) against five that found real
gaps. Verifying is cheap; the ratio is worth remembering when a suspicion feels
urgent.

---

## The baked tile layer was fine, and one function was dead (2026-09-15) ✅

After re-exporting 268 sprites, the question was whether the overworld's baked
tile layer — an offscreen canvas drawn once and blitted per frame — was still
showing the old art. It is not, and the reason is worth recording: its cache key
is

```
${map.id}|${png|code}|${width}x${height}
```

which distinguishes **which source the tiles came from**. When the PNGs finish
loading the key changes, the layer rebuilds, and the new art appears. The one
case it does not cover is a re-export *while the app is running*, which is a
development concern and a reload away from correct.

**And the re-export is byte-reproducible**: running `npm run export:sprites`
again produced *zero* changed files. That retroactively confirms the earlier
finding — the 63 files that changed when the export had drifted were genuinely
different pictures, not encoding noise.

### The sweep's list contained a corpse

`invalidateBakedTileLayer` was in the "named but never called" list, and the
right answer for it was not a test. Referenced **exactly once** — by its own
definition — because the cache key already handles everything it was written to
handle. Removed, with a note in its place saying why. An unused escape hatch is
a maintenance cost with no benefit, and the honest alternative is `git`.

That is the first item from those sweeps where the answer was deletion rather
than coverage, which is worth noting: the list of "named but never called" is a
list of *questions*, not of missing tests.

---

## The design overview had drifted, and the invariants outgrew it (2026-09-15) ✅

`docs/design-overview.md` is the one-page version of the whole thing, which
makes it the document most likely to be believed and most likely to be stale.
Read against the game as it now stands, four claims had been overtaken:

- **"25 maps"** — the list beside it already summed to **23**.
- **"weather applies only to wild encounters, never the circuit"** — no longer
  true, and the session made it false: a shower raises a feud's bar while your
  recorded champion does not move.
- **"tier I is calibrated above what a random 32-car herd does"** — the session
  measured the opposite, in the useful direction: the best of a fresh herd
  *already* clears tier I (2% of cars reach 1,000, none reach 1,220), so the
  first Brand teaches the loop and **the ladder starts asking at tier II**.
- **The tier shape demands were missing entirely**, as was the fact that
  "where you hunt matters" has a direction (the Ice perimeter is the richest
  ground; the grass behind the house plateaus near 1,000).

The **invariant suite** section had the same problem in a different key: it
listed the checks as they stood several sessions ago. It is now grouped into
walking the world, content referencing content, the registers that fail both
ways, behaviour and measurement, and pipelines and docs — which is also a
clearer way to see what the suite is *for* than a flat list of assertions.

One number survived scrutiny and is worth recording: the doc's **94
generations** to clear five Brands is right, and is the sum of the pacing test's
own output (9 / 20 / 25 / 38 / 2). Verifying beat rewriting again.

---

## Four buttons that did not say what they do (2026-09-15) ✅

Last of the copy sweeps: every button and column header, read as a stranger
would. Most are clear (`▶ AUTO`, `Fresh herd`, `SEED HERD`, `STOCK FOR SALE`,
`YOUR SPECIMENS`), and the odd ones turned out to be four:

```
go      ->  Try it        (loads the ground and your best car into the paddock)
Drive   ->  Race it       (loads a recorded lap's car and ground, same thing)
Copy    ->  Copy string   (the same action as the other Copy, now the same word)
Line    ->  🌳 Trace line (the Inspector already said this; the barn said "Line")
```

The last two were the interesting ones: **the same action with two different
names in two places.** `Copy` in the Hall of Fame and `Copy string` in the test
drive; `Line` in the barn and `🌳 Trace line` in the Inspector. Neither is
wrong on its own, and both are the kind of thing a player learns twice.

The rain e2e asserted the ledger row contained the literal word `go`, so it
failed on the rename — which is the assertion doing its job. It checks for
`Try it` now, which is a claim about the row offering an action rather than
about a two-letter word.

---

## How this pass was run

No human/screenshot viewing was possible in-session, so the review used three
layers of evidence:

1. **DOM/CSS/behavioral probes** (Playwright + `scripts/web-server.mjs`):
   computed styles, `getBoundingClientRect`, `hidden` vs CSS `display`,
   keyboard behavior, and canvas pixel readback (`getImageData`).
2. **OCR** of full-page screenshots with `tesseract` (v5.5.2 available via the
   nix profile) — `tesseract shot.png stdout --psm 11`.
3. **A vision-model sub-agent** (see the pi recipe below) that critiqued the
   14 captures and corroborated the probe evidence.

## Confirmed bugs → fixed

### 1. Mode-scoped overlays ignored `hidden` (P1) — FIXED

`game.html` / `index.html`: `.viewport-overlay--actions`, `--status`
(leader pill) and `--progress` (batch bar) set `display: flex`, which overrides
the UA `[hidden] { display: none }` rule. Result: evolution HUD + test-drive
HUD + leader pill + "Batch 0/0" bar rendered in **every** mode (cluttered menu,
overlap with the world D-pad, stale cross-mode readouts). The ⚙ config toggle
was also a no-op (`data-config-panel` had an inline `style="display:flex"`).

**Fix:** one global rule in both shells:

```css
[hidden] { display: none !important; }
```

(Note the inline `display:flex` on `data-config-panel` is now defeated
correctly by the `!important` guard.)

### 2. Overworld never painted — blank green screen (P1) — FIXED

`renderer.ts`: `stopOverworldAnimationLoop()` runs on every non-world
`renderApp()` (including the very first one at boot), which bumped
`overworldAnimationToken` to 1; `startOverworldAnimationLoop()` guarded on
`token !== 0`, so the loop never started and the canvas stayed transparent
forever. No error was thrown. The e2e suite missed it because it only asserted
canvas *visibility* (CSS), not painted pixels.

**Fix** (`renderer.ts`): guard on a boolean (`overworldLoopRunning`) instead of
the token value; wrap `renderOverworld` in try/catch so one bad frame can't
kill the loop. Verified: `paintedPixels == 640*480`.

### 3. Keyboard mode-switch keys dead inside the overworld (P2) — FIXED

`renderer.ts` keydown handler routed every key to `handleOverworldKeydown` in
world mode and returned, so 1-4 / m / o / e / t silently did nothing and the
player could not leave the map by keyboard. Docs claimed the shortcuts worked.

**Fix** (`renderer.ts`): resolve mode-switch keys *before* the world branch
(shared `MODE_SWITCH_KEYS` map; removed the now-dead bottom-switch cases).

### 4. "Save to Hall of Fame" unreachable in evolution mode (P2) — FIXED

The `data-save-to-hall` button lived in the **test-drive** HUD but its handler
(`saveSelectedToHall`) saves the **evolution-selected** vehicle. It only ever
worked because of bug #1 (drive HUD visible in evolution mode). Added a proper
`data-save-selected-to-hall` button in the evolution HUD (visible with the
vehicle focus strip) in both shells; kept the test-drive one.

## Regression tests added

`tests/e2e/vroomon.e2e.ts`:
- "hides mode-scoped overlays and paints the overworld canvas" — asserts the
  evolution/drive HUDs, leader pill, progress bar, config panel are hidden in
  menu mode, correct per-mode visibility, config toggle works, and the
  overworld canvas has >1000 painted pixels.
- "mode-switch keyboard shortcuts work inside the overworld" — 3/2/m/o/t from
  world mode.

## Menu screen — built via A/B (2026-09-10) ✅

`MENU` mode previously rendered only the sample preview with dead
`.viewport-overlay--menu` CSS. Now it ships a proper arcade start screen:

- **Variant A (winner)** — centered cream "title screen" card: VROOMON
  wordmark, pixel-font tagline, green `NEW RUN` primary + WORLD/CONTINUE
  (rows), clickable Hall-of-Fame list, hints + version footer, over an
  opaque slate scrim.
- **B (tried, rejected by user)** — left "garage console" panel with live
  world preview, nav list, GEN/WALLET/BEST stats, keyboard hints. The user
  preferred A: *"I prefer the more explicit menu. I want it to feel like a
  proper game rather than a toy."*
- Both variants were implemented for real in `game.html` + `index.html`
  (selectable via `?menu=a|b`), screenshotted with a populated Hall of Fame,
  pre-reviewed by the vision sub-agent (A 72/100 vs B 58/100) and then A/B-
  tested with the user; after the pick, the loser was removed and the winner
  polished through two vision-review fix passes (measured results):
  - leader pill + status line previously bled through the scrim (1.1:1) →
    mode-scoped `data-viewport-status-overlay[data-mode=evolution]` +
    `z-index:12` status line (9.2:1).
  - gold accents on cream (1.5-2.3:1) → new `--gold-ink: #7a5a12` token
    (4.9-6.7:1); primary CTA gradient darkened.
  - emoji glyphs → dropped/made consistent; button rhythm uniformed
    (12px gaps, 3px shadow).
  - scrim made opaque; gen pill + terrain select + error ring hidden in
    menu mode; HOF entries no longer duplicate the generation in their name.
- `Enter`/`Space` in menu mode starts a new run.

## Race viewport labels — fixed (2026-09-10) ✅

Previously every racer printed its full run id (22px, 5px stroke) clamped to
one y — a "wall of text" at density. Now:

- `layoutViewportLabels()` assigns collision-free label slots cascading
  top-down in score order (21px step, +17px when the focused metric row is
  present). Labels are compact `#N · <seq-tail>`; solo previews keep the label
  directly above the car.
- Travel readout (`NN.NN px`) renders only for leader/selected (+solo),
  tinted to match the label.
- Leader lines run from the label tower to the **top of the vehicle's body
  bbox** (topmost part's x, not the center) and end in a white bead with a
  dark ring; dashes are phase-aligned so a dash lands on the bead; line/dot
  tinted per variant (leader gold, selected blue) so label, line and dot are
  color-consistent.
- Tighter type: 15px labels / 2.5px stroke, 12px metric / 2px stroke.

Verified by 4 rounds of vision-model review (final: 0 critical/high/medium
defects; 4/4 dots touching cars; no metric collisions). Flat gray obstacles,
translucent car blobs, and the clipped bottom caption remain separate backlog
items.

## Player stats HUD + batch pill placement — fixed (2026-09-10) ✅

- `[data-viewport-stats-overlay]` (top-left, below the top bar) renders a
  mode-scoped chip stack: evolution → BEST / POP / GEN / WALLET; world →
  MAP / BADGES / DEX / WALLET; test-drive → HOF TOP / GEN / WALLET; hidden on
  the menu start screen. Values come from live state (wallet, population,
  score history, world badges/vroomdex, map name via `getMap`).
- The batch-progress pill moved from `top: 0.5rem` (behind the fixed 36px top
  bar — a blurred smudge) to `top: 3.25rem` with a solid background; verified
  sharp and centered below the bar.
- Verified by vision-model review (clean chips, no overlap with tabs/leader
  pill/pill) + new e2e test asserting per-mode chip content.

## Focus strip, HOF rows, obstacle/car art — fixed (2026-09-10) ✅

- **Vehicle focus strip**: `focus-chip` styling (active gold / ghost muted) on
  a dark strip backdrop so chips stay legible over any scene, id + score per
  chip, full 8-vehicle row with no clipping.
- **HOF card values** verified populating (Top/saved — earlier 'blank' was an
  OCR misread at low resolution); HOF row meta shortened to date-only
  (`Sep 10, 2026`) and entry names ellipsized.
- **Obstacles**: linear-gradient + dark edge + base contact shadow (no longer
  flat gray slabs); **cars**: dark outlines (no body-merging), wheels drawn as
  tire + accent hub; rank-1 renders gold like the leader pill (leader wins
  over selected for the default selection).
- Verified by 4 vision-model review rounds; 0 blockers on the final pass.

## Cross-mode chrome + boot copy — fixed (2026-09-10) ✅

- The generation pill and terrain select are now hidden in **world mode** too
  (previously only on the menu) — the overworld has no terrain preset and no
  active generation.
- Boot status copy replaced: "Ready to begin the Electron rewrite preview."
  → "Welcome to the Continent of Vroom." (player-facing; the dev catch-copy
  also existed in e2e assertions, updated).
- The bottom status line is no longer clipped: it's a dark pill (padding +
  bottom 0.55rem) and verified inside the viewport bounds.

## Worldbuilding: ranch-faction system (2026-09-10) ✅

The user redefined the fiction (no Pokémon/gym residue): vroomon are
mouse-sized, non-intelligent creatures free-roaming in small ranches; the
player is a racer/rancher. Each biome is its own mini-culture with **two
rival households** you choose between.

- `world/factions.ts` — 12 factions / 6 biomes with local titles: Grassland
  (Meadow Elder/Roundup King), Flat (King of the Commission / King of the
  Underroads), Sand (Trail Boss / Wreck Marshal), Hills (Guru of the Updrafts
  / Guru of the Stone Path), Rocky (Lay Foreman / Ringleader), Ice (Keeper of
  the Long Light / Frost Baron).
- `WorldState.factionChoices` (biomeId → factionId) persists through
  serialize/parse and the main-process file store (backwards-compatible with
  pre-faction saves).
- Grassland mini-story is playable: Meadow Elder (Starter Town) and Roundup
  King (Route 1 → Rustler Pasture, ex "gym_1") each offer the join via a
  dialogue choice; `onComplete: "join-faction:<id>"` records the choice,
  persists it, and surfaces a status line + the HOUSES stat chip; the other
  household appears as the rival. Salt Road Post (ex "Sandy Gym") + gate
  signs stub the remaining biomes behind lore.
- Latent bug fixed along the way: dialogue **option** clicks used a
  text-match lookup that never matched, so any choice silently ended the
  scene — they now resolve the target dialogue by NPC id (faction joins and
  Axle's explain options actually navigate).
- Badge strings re-themed to Brands; docs/index.md + AGENTS.md updated.

## Sand mini-story + overworld reachability — fixed (2026-09-10) ✅

- Salt Road Post (ex "gym_2") hosts the **Wreck Marshal** (join-faction:
  wreckpickers); Route 2 hosts the **Trail Boss of the Salt Road**
  (join-faction:saltcaravan), mirroring the Grassland choice pattern.
- Hills/Rocky/Ice teased as dialogue-only NPCs on Route 2
  (highland-herder / canyon-hauler / frost-courier) naming both factions
  of each biome (gurus; Lay Foreman vs Ringleader; Keeper of the Long
  Light vs Frost Baron).
- Gameplay fixes found along the way (pre-existing, blocked ALL map exits):
  - `attemptMove` left the stored position one tile behind on transition
    tiles, so `isAtEdgeTransition` never matched — no edge transition ever
    fired and the overworld was a dead end. Now the position advances onto
    the tile and transitions fire.
  - Map transitions committed in a microtask never re-rendered the new
    map; added `onMapTransition` so the overworld paints immediately.
  - Starter Town's exit was parked on an untraversable tree tile — moved
    to path (13,2); Route 1 gained the Salt Road entrance at (18,6).
- Note: tests/world.test.ts was accidentally committed with every describe
  doubled; deduplicated (140 distinct unit tests).

## Sand passage playable end-to-end — verified (2026-09-10) ✅

The full world loop now works and is covered by an e2e (19s): Starter Town →
Route 1 → through the vroomgrass wild-encounter band → Route 2 → stand at
the Trail Boss and join the Salt Road Caravan. Wild-encounter tiles only post
a status line (non-blocking), so navigation never stalls.

- The Route-2 gate was originally on route_1 (18,6) — the tile Rider Vicky
  stands on — so the crossing was impossible. Moved to (18,5) (return trip
  lands there too).
- Approach quirk: the Trail Boss occupies (6,12), so the player must stand at
  (5,12) facing right (or (7,12) facing left) to talk.
- Hills/Rocky/Ice faction mini-stories remain dialogue-only teasers until
  those biomes get maps (deferred; their two-faction lore is in place).

## Herd Book rename — done (2026-09-10) ✅

All player-facing "Vroomdex" copy is now "Herd Book": the stats chip label
(DEX -> HERD), Professor Axle's dialogs (option label + the fingerprint
explanation), the "N specimens recorded in your Herd Book" readout, and the
overworld reset confirm. Internal identifiers (world.vroomdex,
data-overworld-vroomdex-count, onVroomdexTick, the "vroomdex" onComplete
kind) stay as-is to avoid churn.

## Hills / Rocky / Ice biome maps — added (2026-09-10) ✅

The three remaining biomes are now playable maps chained off Route 2's
mountain pass (`19,3`):

- **Highland Mesa** — Guru of the Updrafts (Skimmers) vs Guru of the Stone
  Path (Miners); `join-faction:skimmers|miners`.
- **Canyon Quarry** — The Lay Foreman (Stonecutters' Union) vs The
  Ringleader (Canyon Runners); `join-faction:union|runners`.
- **Drift Perimeter** — Keeper of the Long Light (Herdsmen) vs The Frost
  Baron (Drift Syndicate); `join-faction:herdsmen|drift-syndicate`.

Chain: Route 2 → Highland Mesa → Canyon Quarry → Drift Perimeter (returns
west each way). All hosts use the choice-dialogue pattern and the
factionChoices persistence from earlier. Also fixed the pre-existing
"ghost sprite" cosmetic bug: dialogue-stub NPCs (conventionally parked at
0,0 on impassable tiles) are no longer rendered at map corners — only
physical NPCs on walkable tiles draw. Map data is validated by a script
(reachability + transition targeting) and guarded by unit tests (144 total
incl. biome hosts, joins, and the chain).

## Web persistence — wired (2026-09-10) ✅

The web build's store was memory-only, so Hall of Fame / run / world state
vanished on every reload. The shim (playwright-preload-shim.ts) now persists
to localStorage per origin (`vroomon:*` keys) with a graceful in-memory
fallback when storage is blocked (private mode / sandboxed iframe). Desktop
Electron's main-process file store is unchanged. New e2e proves: save run
state → reload → load (terrain preserved), and join a faction → autosave →
reload → HOUSES chip still shows the choice.

## Legacy Python suite — restored to green (2026-09-10) ✅

The reference prototype's suite was red (12 failed + 3 errors). All three
known drifts fixed:

- test_rectangle: 6 tests patched `builtins.print`, the code now warns via
  loguru — tests assert `logger.warning` instead.
- test_population_mutate: fixture patched dead module attrs; mutate() resolves
  parts through `_runtime_dependencies()` — fixture now stubs the resolver
  (Dummy parts + a non-Car sentinel class so the fallback branch runs).
- test_simulation: the module moved to lazy `importlib`-based pygame + narrow
  exception handling; tests now use an importlib seam that delegates other
  imports to the real import_module (keeps patch() resolution working). Code
  hardened alongside: pygame-missing falls back to a headless run with a
  warning; draw errors are caught broadly and disable viz; car-removal errors
  are logged (debug) instead of crashing.
- pyproject: `full_auto_ci` moved from runtime dependencies to an optional
  `ci` group (it was never imported by vroomon).

Run: `nix-shell -p python312Packages.pytest python312Packages.pygame
python312Packages.pymunk python312Packages.tqdm python312Packages.loguru --
run "python -m pytest -q"` → 101 passed, 17 subtests passed, no failures.

## HERD TREND chart + MEAN chip — added (2026-09-10) ✅

Playtest finding: best-score is very noisy generation-to-generation while
the stable signal (mean) lived only in hidden diagnostics — progress didn't
read like progress. Now:

- A **HERD TREND** panel (bottom-right, evolution mode only) mirrors the
  score chart (best gold bars + mean blue bars + first/last generation
  labels) that was previously rendered only into a hidden stub.
- The evolution stats HUD gained a **MEAN** chip (last generation's mean)
  alongside BEST/POP/GEN/WALLET.

Both are mode-scoped and covered by the stats e2e. 144 unit + 16 e2e pass.

## Ranch economy — wired into the game (2026-09-13) ✅

The dictionary-seeded inspiration pack (docs/economy) became a real system:

- `src/core/economy.ts`: six purchasable ranch upgrades with 5 tiers each —
  The Shrewed (pasture: +25 herd cap/tier), Gamesman Stalls (+10 HOF slots),
  Hardwired & Placate (+2% retain), The Surcingle (+2s races), The Pretence
  (−1% mutation), Atmometer Tack (+10% income). Costs 40..1200 base, ×tier.
- Effects land at the right seams without double-counting: the effective
  config sizes new populations and breeding knobs (runEvolutionGeneration)
  but is never baked into stored config; income multiplies in advanceRunState;
  HOF capacity grows in addHallOfFameEntry.
- **RANCH YARD store**: a 🌾 RANCH button in the evolution HUD opens a modal
  (six cards, wallet, tier/level, effect now→next, buy with disable when
  unaffordable/maxed); purchases debit credits, set the status line, and
  persist. Upgrades are **campaign progression** — auto-loaded at boot via a
  dedicated upgrades store (web: localStorage `vroomon:upgrades`; desktop:
  IPC + `upgrades.json`), so they survive runs and reloads.
- HUD surfacing: the evolution stats add HERD (effective herd cap — 125
  after The Shrewed, while POP shows the live herd) and a RANCH L<n> chip
  counting owned tiers; the store cards carry per-upgrade icons and buy
  actions play tiny WebAudio blips (coin/deny).
- Unit tests cover the economy (costs, wallet, caps, modifiers, capacity,
  income) and an e2e plays the full loop: earn 40 cr → buy pasture → herd
  grows 100→125 on regenerate → reload keeps tier 1/5 in the store.
- 151 unit + 17 e2e pass.

## Biome feud payoffs + brand revival (2026-09-13) ✅

Roadmap #1. Every faction host (all 10 across the six biomes) now offers a
"Race to settle the feud" option that reuses the gym-race scaffolding; the
winner's local Brand is awarded (BADGE_BY_MAP extended to starter_town /
route_2 / hills_map / rocky_map / ice_map — Grassland/Salt Road/Highland/
Canyon/Perimeter Brands) with feud-flavoured status copy.

Two latent bugs fixed along the way:
- completeDialogue returned a pre-side-effect state, so advanceDialogueInput's
  `commit(...)` instantly wiped badges/factions awarded inside the nested
  onEncounterStart handler — now returns the live closure state.
- endDialogue populated currentEncounter for trainer/gym onComplete, which
  made persistWorldState bail (activeNpc || currentEncounter guard) — the
  world NEVER saved after a gym fight. Encounters are fire-and-forget
  reports; currentEncounter is left untouched (and saves work again).

Tests: unit feud-node coverage (10 nodes, onComplete gym, brands) + a
feud e2e (Elder -> Race feud -> Grassland Brand in status AND badge list,
surviving reload). 152 unit + 18 e2e pass.

## Ranch decor — purely pretty things (2026-09-13) ✅

The RANCH YARD store gained a **ROOM TO ADORN** section: eight cosmetic
decor items (🌻 Sunflower Bower, 🌷 Wildflower Bed, 🦆 Duck Pond, 🐝 Bee
Skeps, 🧺 Hay Hamper, 🌳 Shade Spindle, ⛲ Wishing Well, 🎏 Weather Pennant,
10–34 cr) with NO gameplay effect. Purchases are placed in Starter Town's
meadow (canvas-drawn emoji under NPCs/player at anchored tiles), persist in
world state (`decor: string[]` — web localStorage + desktop file store,
parse-tolerant), and survive reloads with a canvas-draw e2e check.

Also: persistWorldState now serializes rendererState.world (carries decor —
it previously could only see the controller's world).

## Decor polish (2026-09-13) ✅

- Meadow decor now draws at ~2x the tile size with a grounding shadow — it
  reads as scenery instead of a tiny glyph.
- Each of five decor items gained an extra per-biome spot (Sunflower Bower on
  Route 1, Wildflower Bed on Route 2, Duck Pond in Highland Mesa, Bee Skeps
  in Canyon Quarry, Hay Hamper on Drift Perimeter), verified passable and
  NPC-free by script.
- The RANCH YARD store shows a fade-in/out toast on purchases
  ("🌻 Sunflower Bower placed in the meadow" / "The Shrewed built to tier 2")
  alongside the status line.

## Sprite palette formalized + faction-coded hosts (2026-09-13) ✅

- New `world/sprites-palette.ts`: a single source of truth for overworld
  sprite colors (skin/ink/feet/cap/body/accent roles mirroring the warm
  meadow theme) — NPC palettes, the player sprite, and the viewport label
  tints (leader gold, selected blue) all route through it. Pure refactor,
  no visual change for existing sprites.
- **Faction-coded hosts**: each of the 10 household bosses wears their
  house's signature accent band (meadow green, rust red, dune tan, salvage
  brown, summit sky, stone brown, safety blue, stunt orange, aurora pale,
  ice slate) via HOST_ACCENTS — the Meadow Elder now reads Greensprouts at
  a glance vs the Roundup King's rust.
- Tile/terrain fills remain in TILE_COLORS (sprites.ts) with intentional
  detail fills (tree shade, vroomgrass sparkle, outline highlights).
- Unit tests: palette roles, 10 distinct house accents, and every host id
  resolving in the maps. 156 unit + 12 e2e pass.

## Grand Roundup — the game now has a win state (2026-09-13) ✅

"Beating Vroomon" is now a real thing: earn all **five arena Brands**
(Grassland, Salt Road, Highland, Canyon, Perimeter — Flat is the training
track), enshrine a champion in the Record Barn (Hall of Fame), then talk to
the Roundup King and **Run the Grand Roundup**. Completing it marks the world
flag, plays a celebration overlay (🏆, champion name/DNA/score), and the
stats HUD shows an honest **BRANDS n/5** chip. Decline branches cover
missing Brands / no champion gracefully. e2e covers both paths (seeded
world + hall); unit covers the node. 157 unit + 13 e2e pass.

Estimated completion: ~45 min for the tour + Brands; ~1-1.5 hrs for a real
rancher run ending in the Grand Roundup (completionist is the ~8-12h
upgrade grind, which is now optional beyond the win).

## Character creation + story opening (2026-09-13) ✅

- **Brand Yourself card** (menu, variant A): name your rancher (max 24
  chars, used in the Grand Roundup finale copy) and pick a cap color —
  navy / rust / meadow green — drawn on the player sprite (a new cap brim).
  Persists in world state (web localStorage + desktop file store).
- **Opening beats on first world entry**: an arrival line ("The road
  carries you to Starter Town…"), a first objective
  ("Professor Axle is at the schoolhouse — talk to him (Z)…") that stays
  until you meet him, and Axle's farewell now sets the goal
  ("Race a champion, win a Brand, and outrun the road.") with a met-axle
  flag. All flag-driven, so replays go back to the neutral summary.
- **Canon copy sweep**: you *run/race* the herd — vroomon are beetle-sized
  livestock. "Ride a champion" → "Race a champion", faction invitations
  "Ride with us" → "Run with us", "Ride for the Reds" → "Run for the
  Reds"; road/wind idioms ("drive safe", "ride the updrafts") kept.
- Fixed along the way: renderApp's world re-sync was dropping decor +
  identity from the persisted world (they now mirror into the controller);
  widget TDZ at boot (lazy queries); the status line now updates inside
  renderOverworldUi (not just renderApp).
- e2e: creation → arrival → objective → Axle → farewell goal → persisted
  identity; unit covers the identity roundtrip. 158 unit + 14 e2e pass.

## Race presentation + audio (2026-09-13) ✅

- **Race-result card**: feud and rider races now play a moment — a
  3-2-1-GO countdown flash, then a result card (map/rival crossed x=…,
  a bragging line, win/place chord), dismissible with OK and auto-hiding.
- **Synth audio module** (`renderer/audio.ts`, WebAudio, no assets): coin,
  deny, click, countdown beeps, win/place chords, and a finale fanfare;
  each cue owns+closes its context and fails silently. Ranch store blips
  route through it now.
- Re-added the feud e2e (lost during an earlier tail rebuild) and extended
  it to assert the race card appears and dismisses. 158 unit + 15 e2e pass.

## HUD quest/objective line (2026-09-13) ✅

- **Quest director** (`renderer/world/quest.ts`, pure + unit-tested): reads the
  world state and tells the player what's next —
  talk to Axle (opening) → next un-earned Brand in biome order
  (venue + whom to race, with a "choose your house first" hint when the
  biome has no house joined) → Grand Roundup once all five Brands →
  post-Roundup freedom line. So the summary objective and the "what do I
  do now" line always agree as flags/badges change.
- **Objectives chip**: appended inside the world stats HUD (gold pixel-text
  main line + soft hint). Fix: the dialogue advance/option paths now
  refresh the stats HUD too, so the chip flips the moment flags change
  (previously only the world-summary refreshed).

## Herd management tools (2026-09-13) ✅

- **Family lines**: every car already carried its parents; the sim also
  writes genealogy edges (parent -> children) each cycle. Now the Record
  Barn captures a 4-generation ancestry at save time and a **Line** button
  opens a lineage panel (parents -> grandparents -> … with names resolved
  against the Record Barn + current herd, plus live descendant count).
- **Split Pens upgrade ("The Split")**: 3 tiers × +2 stud slots. Cars
  marked **STUD** in the Record Barn get first pick in every breeding
  cycle (2/3 of first-parent picks + 2/3 stud-parent line-ups when the
  pen holds 2+), so you can concentrate a bloodline while the herd still
  mixes. Gated: no slots -> clear "buy The Split" message.
- **Mutation control**: the existing *grooming* upgrade (-% mutation) now
  has a consumable companion — **Calm Tonic** (no mutation next cycle)
  and **Wild Brome** (+15% next cycle) in the RANCH store's SUPPLIES row.
  Stock drains exactly once when the next cycle runs.
- **Favorites**: ★ pin in the Record Barn sorts pinned cars to the top.
- **Fix that mattered**: the Rename/action buttons only existed in a
  hidden diagnostics panel — players could never reach them. All five
  actions (rename/favorite/stud/line/remove) now render on the visible
  menu Record Barn. The HOF test-drive card keeps click-to-load.
- Seeds: `pens` upgrade id; run-state fields `supplies` + `penIds`
  (optional, old saves safe). 171 unit + 16 e2e pass.

## DNA share/import (2026-09-13) ✅

- **Copies** everywhere a genome matters: Record Barn entries (menu hall),
  the selected car in evolution (⧉ Copy), and the test-drive draft — via a
  clipboard helper with a legacy textarea fallback for old webviews.
- **Import**: paste a champion string into the evolution "Paste DNA…" input
  and hit 🌱 Seed — the imported genome becomes the herd's top seed (the
  highest-scoring entry is swapped which, on a fresh herd, is entry 0), so
  a shared champion string can re-enter any run and breed onward. The
  genealogy map stays valid because ids are untouched.
- New `plantSeedDna` helper (+2 unit tests); e2e covers barn-copy,
  draft-copy, and seeded-population assertions. 173 unit + 17 e2e pass.

## Ambient sound pad (2026-09-13) ✅

- **Ambience engine** (`renderer/ambience.ts`): a synthesized, asset-free
  pad that breathes under the event sfx — per-scene profiles (menu /
  meadow / dunes / upland / quarry / drift / trackside) mapped from the
  current mode + overworld map. One persistent AudioContext (the sfx
  cues keep their own short-lived contexts), started only after the first
  user gesture, with slow crossfades between scenes and a 0.09 Hz
  breathing LFO.
- **Sound chip**: top-right 🔊 toggle cycling med / low / off; the choice
  persists in localStorage (`vroomon:ambience`) and survives reloads and
  the future settings surface.
- Scene changes ride renderApp, so walking a biome switch crossfades the
  pad automatically. 173 unit + 18 e2e pass.

## Records Board + ghosts (2026-09-14) ✅

- **Records**: Test Drive laps are judged at the end of every viewport loop
  — the draft's ground covered on the race window competes per terrain.
  Improvements land in a RECORDS board (menu, under the Record Barn):
  best score per biome + the DNA that set it + a **Drive** button that
  drops the record straight back into Test Drive.
- **Ghosts**: when the draft races a terrain with a standing record, the
  sim is replayed with both cars head-to-head and the record car renders
  as a translucent teal **RECORD** ghost on the same track — literally
  racing your own past run.
- Persistence rides the platform (localStorage on web, file store + IPC
  on desktop) behind `loadRecords/saveRecords`, mirroring the Hall of
  Fame pattern; `records.ts` (best/propose) is pure + unit-tested and the
  new lap fires a non-intrusive toast (the earlier inline-status version
  clobbered the flat-track replay notice — caught by e2e).
- 177 unit + 19 e2e pass.

## Settings + save transfer (2026-09-14) ✅

- **Settings panel** (⚙ top-right): **master volume** slider applying to
  every sfx cue and the ambience pad (audio.ts + ambience.ts now take a
  global gain), and **ambient pad** Med/Low/Off — the old top-right chip
  stays as a quick cycle and stays in sync. Persisted under
  `vroomon:settings` (localStorage; the legacy `vroomon:ambience` key
  migrates in once). `settings.ts` normalization is unit-tested.
- **Save transfer**: export world / export run as base64-JSON share
  strings (auto-copied to the clipboard and shown in the panel's
  textarea), and import either by pasting a string back — validated
  round-trips (`save-io.ts` nulls garbage). World import restores the
  overworld live + storage; run import lands in the run state.
- 183 unit + 20 e2e pass.

## Dialogue texture (2026-09-14) ✅

- **Portraits**: every overworld dialogue now shows a parameterized SVG
  bust for the speaker — per-NPC archetypes (scholar glasses for Axle,
  crown for the Roundup King, beard + staff for the Meadow Elder,
  eyepatch marshal, bandana riders, miner's lamp, fur-hood couriers,
  sage wraps, shopkeep coin) drawn from the shared palette, with a
  generic rancher fallback and a quill bust for the narrator.
  `portraits.ts` is pure + unit-tested.
- **Typewriter**: dialogue text reveals progressively (~2 chars/11ms,
  chunkier for long lines) — Z during typing completes the line AND
  advances text lines (classic skip-through); option beats only complete
  so the menu stays interactive. Options render immediately so gameplay
  never waits on the animation. e2e re-verified across all conversation
  flows (the first cut gated options behind typing and broke fast flows —
  caught by the suite). 186 unit + 20 e2e pass.

## Polish pass (2026-09-14) ✅

- **Arena banner garlands**: feud arenas (gym_1, gym_2, hills, rocky,
  ice) now string a sagging pennant garland across the top — the joined
  house's accent on the home half, the rival's on the far half, neutral
  gold before you pick a side. Sways with the overworld tick.
- **Decor catalog 8 → 12**: Salt Road Marker, Meadow Lanterns, Roundup
  Bell, Trellis Arch (each with a biome spot).
- **World-state version stamp**: `worldVersion` (optional in the
  persisted shape) so future worldbuild iterations can migrate old saves
  explicitly; old saves without it read as version 1, always tolerated.
- 186 unit + 20 e2e pass.

## Onboarding: a slow, guided start (2026-09-14) ✅

- **NEW RUN now begins the story**: it lands you at Starter Town with the
  arrival line + Professor Axle objective (walk with arrows/WASD, Z talks)
  instead of dumping you into a racing screen. The menu gained an opaque
  backdrop, a clearer tagline ("Ranching, not racing sim…"), and a
  HOW TO PLAY strip outlining the four loops.
- **First-visit guide banners**: Evolution ("Generate a herd, breed with
  Run Gen, save your champion 🏅") with an auto-generated starter herd so
  the guide has something to point at, and Test Drive ("beats records
  plant ghosts"). Banners clear on any interaction (never block play) and
  persist as seen (`vroomon:tips`), so returning players never see them.
  Fixes a temporal-dead-zone bug where the boot render read the banner
  array before it initialized.
- 188 unit + 21 e2e (new onboarding e2e: NEW RUN lands in world,
  banners show/dismiss/persist). 

## NPC-led teaching: no meta-guide UI (2026-09-14) ✅

- Removed the HOW TO PLAY strip and the first-visit banners entirely —
  the game never spells out the loop in chrome; the fiction teaches it.
- **Professor Axle** now offers "How do I breed a champion?" — a beat
  explaining the paddock loop (breed on the bench → Run Gen → save to the
  Record Barn → records board) in-story, next to the Herd Book beat.
- **Wrench Wanda** (the starter-town shopkeeper) introduces the Ranch
  fitters' yard: pasture/stalls/tonics, and that credits come from every
  lap the Barn pays out, with a "What should I buy first?" beat.
- **Rider Vicky** (first rival) teaches racing in fiction: stand the line,
  tap Z, test-drive any bred car first, and race your own recorded ghosts.
- NEW RUN still opens the arrival story; the status line is pure
  atmosphere now (no control-syntax dump). 186 unit + 21 e2e pass,
  including a new e2e asserting Axle's paddock beat and Wanda's store
  teaching.

## The cinematic opening (2026-09-14) ✅

**Title screen**: only NEW GAME (or CONTINUE once a rancher exists), and a
looping attract race of six cars runs behind the translucent title — no
other chrome. The Record Barn + Records managers moved into a 🏟 Barn
panel in world mode (same lists/actions, still browsable).

**New Game story**:
1. Monologue beats: *"Oh what a long trip it was to get to the Isles of
   Speid… At least I've finally got the chance to start over… Maybe I
   should even change my name."* → the name + cap moment.
2. *"Hey sleepyhead! Time to wake up!"* — you wake beside the bed in the
   **shoddy ranch** (new `home_ranch` map: bedroom, kitchen, tall-grass
   yard, garden gate).
3. **Rancher Robby** in the kitchen: options *"Of course — but I didn't
   see any cattle on the way in?"* / *"For sure! How do I start!"* →
   the reveal: vroomon are beetle-sized wheeled critters, not cattle,
   and the yard floods with them; the ranch is yours.
4. Tutorial: catch a wild vroomon in the tall grass (interact → genome
   recorded into the Herd Book), Robby's praise beat auto-follows, then
   *"alright, that's all for today! explore town"* — the garden gate
   opens onto Starter Town and the existing road begins.

Also: dialogue flag changes now persist (z-advance + option clicks save
the world state — previously reveal flags were lost on reload), the menu
overlay is pointer-event transparent so the attract race + top bar stay
clickable, and the settings gear moved off the ambience toggle's corner.
186 unit + 21 e2e (a full opening-journey e2e walks trip → name → wake →
Robby → reveal → catch → gate).

## Opening polish + real sprite assets (2026-09-14) ✅

**Opening input & pacing**: clicking the intro card advances the beats
(Z/Enter too); Enter no longer loops on beat 2 (the intro now owns all
input while open, so the menu's start shortcut can't reset it); the
overworld dialogue box also advances on click. **Robby's dialogue is now
one sentence per box** (the reveal, the yard lesson, the catch praise),
click-through at a calm pace. Found + fixed a dialogue-engine bug:
setFlag was ignored on beats that ALSO chain forward — those flags were
silently lost (the reveal state vanished on reload).

**The tools are now shown, not just mentioned**: the 🏟 Barn panel gained
a real **Herd Book** section listing recorded genomes; after your first
catch Robby's beat tells you to open it, and the Barn button **pulses**
until you do. The ambience + settings buttons hide in world mode, and
every overworld NPC now has a **name tag** (faction-accented border) so
the world reads clearly.

**Sprite asset pipeline**: `npm run export:sprites` renders all 96
code-drawn sprites (tiles, NPCs, player facings) to real PNG files in
`src/renderer/assets/sprites/` + a manifest; `copy-static` ships them to
dist and the runtime **prefers the PNG files** over the code drawing
(which stays as fallback). This is the drop-in seam for AI-generated art:
name a PNG the same as its manifest id and rebuild — the game uses it.
(No image-gen model/API exists on this host, so generation itself needs
either a local GPU install or an API key placed in `.secrets` per the
repo's rules.)

## The ranching loop + component sprites (2026-09-14) ✅

**Ranching in a box**: the flock now behaves like your lore — a
microwave-sized **carrier** you keep on your hip (Robby hands it over
with the first catch; Wanda tells you it runs on grain). Gameplay:
- **Feed** is a resource riding the carrier. Every generation **costs 1
  feed** (Run Gen and batches are cut off with an "Out of feed" message /
  the batch trims to what you can feed).
- **Releasing pays it back**: 🐄 Release the selected vroomon (+1 feed,
  herd shrinks) or ⚡ Cull slow — keep the top ten, release the rest
  (+1 feed each). That's exactly "release the slower mons and keep the
  faster ones", and it funds the next breeding run.
- The RANCH store sells **🌾 Grain** (36 cr → +6 feed); the stats HUD
  gained a FEED chip. `releaseFromPopulation` / `keepFastest` are pure +
  unit-tested; a new e2e walks out-of-feed → grain → breed → release →
  cull. 189 unit + 22 e2e.

**Component sprite system**: NPCs are now assembled from three
independently generated parts — **head** (skin + face), **outfit**
(torso + trades), and **accessory** (caps/glasses/stetsons/wrenches/
bandanas/signposts) — drawn in order around a shared anchor. The exporter
emits each part as its own PNG (`head:light`, `outfit:labcoat`,
`accessory:stetson`, …) plus the assembled `npc:<id>` (runtime unchanged).
Parts can be swapped per-component, and AI-generated art can replace any
part or whole NPC by manifest id.

## Tile sprite components (2026-09-14) ✅

The same component treatment now applies to **backgrounds and walls**:
- **Ground tiles** are two layers — `tilebase:<kind>` (fill, corner shade,
  blades/pebbles/planks) and `tiledetail:<kind>` (vroom-grass glints,
  water waves, tall-grass blades, doormat weave, furniture like the bed,
  rock faces, door panels, building trim).
- **Wall faces** are assembled per kind from `wallbase:<kind>` (mortar),
  `wallbrick:<kind>` (brick courses with running offset), and
  `walltrim:<kind>` (coping + skirting shadow), shared by wall, building,
  and tree-trunk.
- The exporter now emits 146 sprites (every `tile:<kind>` assembled
  PNG, plus the per-layer files and the NPC head/outfit/accessory +
  player parts); the runtime still consumes the assembled `tile:<kind>`
  images, so behavior is unchanged and each layer is a drop-in AI-art
  swap target by manifest id. Layer outputs verified by pixel sampling
  (bricks, mortar, trim, glints). 189 unit + 22 e2e pass.

## Pocket Ranch: the world is the hub (2026-09-14) ✅

- **The top-bar mode tabs are gone** (and their 1-4/m/o/e/t shortcuts):
  the overworld is the game, and the title screen is boot-only.
- **The 🏟 carrier button opens the Pocket Ranch** — one full-screen hub
  with three scenes and a pill switcher:
  - **🐄 Herd** — the breeding bench: Generate / Run Gen / Batch, FEED,
    release, cull, copy/seed DNA, config.
  - **🏁 Test Drive** — the paddock: draft DNA, terrain, replay, records.
  - **🏟 Barn** — Herd Book, Hall of Fame, Records (with their actions).
  - **Back to the road** (or Escape) returns to the overworld, which
    pauses behind the carrier.
- The hub's scene follows the underlying mode, so loading a saved
  test-drive run (or a record's Drive button) lands on the paddock; the
  barn lists refresh on every open. Hub status copy narrates each scene.
- **The tie is diegetic too**: your **Carrier Bench** stands in the yard
  (beside Robby) — walk up and press Z to crank the herd awake and open
  the hub, so the overworld and the pocket ranch are the same place.
- Fixed en route: a leftover mode-button guard that threw on boot (the
  renderer silently died), CONTINUE never appearing on reload (the world
  load didn't re-render the shell), and the hub not syncing `runState.mode`
  (a reloaded save opened the wrong scene).
- 189 unit + 22 e2e pass (all navigation rewritten to the hub flow).

## Screenshot pass + sprite bake + test tiers (2026-09-14) ✅

Read the actual screenshots and fixed what they showed:
- **Title**: the attract race was hidden behind an opaque backdrop — now a
  translucent vignette, so the six-car race runs visibly behind the title.
- **Name tags**: were ~25 screen-px tall; now tile-scaled (small, subtle).
- **Sprites were half a tile and exported PNGs mostly empty**: the drawing
  geometry was hardcoded in pixels — now proportional to the tile, so
  characters read at world scale *and* the 96px exports are full.
- **World framing**: outside the map is deep forest instead of bright
  meadow (the letterbox read as empty paint).
- **Bed tile** redrawn (frame + mattress + striped blanket + pillow — the
  first thing a new rancher sees), tall-grass blades de-tiled from a
  dashed "fence" pattern, quest text given contrast, dialogue portraitz
  zoomed/enlarged, hub bar no longer wraps.
- **Settings toggle stays reachable** everywhere (hiding it in the world /
  hub made volume + save transfer impossible mid-session).

**Sprite bake (perf)**: the static tile layer is now baked once per map
into an offscreen canvas and blitted in one call — overworld draw calls
per frame dropped from ~195 to ~4 (**11,700 → 240 draw calls/sec**), with
no visual change. `npm run export:sprites` now writes `source` tags and
**preserves entries marked `generated`** (hand-made/AI art survives
re-exports; `--force` overwrites), which is the mix-and-match rule.

**Test tiers**: e2e now runs in parallel workers (2m25s → **46s**), with a
`@smoke` subset (**22s**) covering the paths that break silently; unit
tests stay at ~5s. See DEPLOYMENT.md.

## The evolution lab: dials, auto-run, outliers (2026-09-14) ✅

Reframed the herd bench away from "approve every mating" toward the
evolution-simulator core (the BoxCar2D lineage of the design):

- **Sim dials always visible** on the bench — HERD (20–400), MUTATION
  (2–50%), KEEP (10–75% retained), DNA length — replacing the hidden ⚙
  config panel. Dialling the simulator is now the front-and-centre act.
- **▶ AUTO**: grinds generations back to back (~0.6s apart), with
  *stop at plateau* honoured (6 dry generations), feed spent per
  generation, and automatic stops on out-of-feed or when you leave the
  bench. The button shows a live count (`⏹ AUTO · 6`) and the status line
  reads `Auto-run gen 6 · best 1001.93 · 3 dry`.
- **Outlier callout**: any generation whose best beats the run's all-time
  best by ≥2% throws a gold `NEW OUTLIER · 1001.93 (+7%)` banner with the
  win chord — the "lucky generation" moment the loop exists for. Manual
  and batch runs celebrate too.
- The BEST chip is now the **all-time** best (it showed only the latest
  generation, so it disagreed with the auto-run summary).
- `evolution-lab.ts` holds the pure decisions (`isOutlier`,
  `autoRunVerdict`, `improvementRatio`) with 7 unit tests; a `@smoke` e2e
  dials the sim and watches the counter climb without further input.

Next (from the user's steer): a **heritage/lineage tree** view so you can
trace how a champion emerged, and **scaling biomes** so yesterday's
champion is obsolete when the terrain gets harder.

## The heritage tree (2026-09-14) ✅

A fourth Pocket Ranch scene — **🌳 Heritage** — because watching families
develop was called out as a top-loved part of the design:

- **The family fabric**: every vroomon the run has ever bred is a node,
  grouped into generation columns by ancestry depth, joined by parent →
  child curves (gold for mutated offspring). Untraceable/released stock
  renders as small slate dots; scored stock scales with the best.
- **Trace a line**: tap any vroomon and the whole book dims except its
  ancestors and descendants, its chain labels itself, and the info line
  reads `#72 · 130.69 pts · gen 7 · line: #12 ← #30 ← #55 ← #72 · 3
  descendants`.
- Champion labels sit along the top per generation (with a collision
  guard), the depth ruler runs gen 0 → gen N, and the header summarises
  `75 vroomon · 22 champions · 23 generations deep`.
- `heritage.ts` holds the pure model (`buildHeritageGraph`,
  `traceHeritage`, `shortLabel`) with 9 unit tests; a `@smoke` e2e breeds
  four generations, opens the tree, checks it painted, and taps a node.
- Fixed on the way: the tree read scores from the run-state population
  (always 0) instead of the last evaluated generation, and the heritage
  scene was being overridden by the scene-follows-mode sync.

## The circuit: sweeps scale the bar (2026-09-14) ✅

The "find a new champion" pressure the design called for — a swept area
gets harder instead of just paying out a Brand:

- **Feuds are real contests.** Each arena has a **bar**: the score your
  best champion must beat. Tier I Grassland is 600; Ice starts at 840.
  The feud race compares your Record Barn's best on that terrain (or the
  live herd's best if the barn's empty) against the bar and tells you the
  result — `the bar was 600 — your champion answered 900` or
  `short by 68`.
- **Sweeping raises the bar.** A win awards the Brand *and* advances that
  circuit a tier (`×1.28` per sweep), keyed by **Brand** so the whole area
  scales: Grassland I 600 → II 768 → III 983 → IV 1258 → V 1610. A 900
  champion takes I, scrapes II, and is turned away at III — which is
  exactly when you go back to the bench.
- **A CIRCUIT readout on the bench** (`CIRCUIT Grassland II · 768 ✓`) says
  what you're breeding against and whether your champion currently clears
  it.
- `circuit.ts` is pure (`feudBar`, `tierOutcome`, `badgeForMap`,
  `nextCircuitTarget`, `venueTitle`) with 10 unit tests; the map → Brand
  table moved there so awards and tiers can't disagree. Two e2e tests
  cover the sweep (Brand + tier II) and the turn-away (short by 68, no).
- Fixed on the way: `persistWorldState` hand-listed its fields and so
  dropped new world state (circuit tiers) — it now uses the shared
  serializer.

## Three ways a written scene quietly stops working (2026-09-15) ✅

Content that references other content by name is content that can rot. The
controller degrades gracefully at every one of these — it shrugs, keeps
running, and the scene simply does not happen — which is exactly why they need
checking from the outside:

**A `goto:` that lands nowhere.** It names a map, a tile and the story node on
the far side. A bad tile and the beat drops the player inside scenery; a bad
node id and the hand-off is silently skipped, so the scene ends without
picking itself up. The audit resolves every one and requires the map to exist,
the tile to be passable, and the named node to have dialogue on the far side.

**A `next:` that names nobody.** Dialogue links resolve by hunting for an NPC
with that id on the same map — story nodes live on invisible NPCs parked at
0,0 — so renaming one cuts a conversation in half with no error anywhere.
Every `next` and every option target is now resolved.

**A flag nothing ever sets.** A condition on an unwritten flag can never fire:
written, placed, unreachable. This is how the tutorial's reveal went missing
once already, so it is checked at the source level now — every
`flags["..."]` read anywhere in the renderer, controller, quest chain or side
quests has to be written by a dialogue or by code.

All three have teeth, verified by mutation — a typo'd flag read reports
`flags read but never set: met-axl`, and a bad `goto:` reports
`lands on tree at ranch_yard:0,0`. None of them found a live fault today,
which is the point of writing them now rather than after the next map is
reshaped.

## Where people are, and where the map file says they are (2026-09-15) ✅

Chasing the "can you always talk to this person" question turned up something
better than the thing I was looking for.

**The facing rule I assumed does not exist.** Interaction is about the
*player's* facing: you stand next to someone and press Z. A keeper staring at
a wall is only ever a cosmetic oddity. So the real contract is not "the keeper
faces a walkable tile" — it is:

> there is a walkable, reachable tile next to the keeper that nobody else is
> standing on, for every keeper, at every hour

A night watch that moves into a nook with no reachable neighbour would be a
person you can see and never speak to. Swept across the clock in hundredths:
none. (There is one facing rule with no legitimate exception, so it is
asserted too: nobody faces off the edge of the map.)

### Two answers to "who is standing here"

`attemptMove` looked up an occupant by the **static** `npc.x / npc.y` from the
map file, while `findAdjacentNpc` — what actually decides who you talk to —
uses routine positions. Two answers to the same question is how a bug gets
written later. The static lookup is the wrong one: a keeper with a routine
leaves their tile at dusk, so the map file's answer is a person who is not
there.

`attemptMove` now uses the same `npcOnTile` helper, and a test walks into a
morning tile at night. Reverting the fix reproduces it:

```
long_haul: the tile cook-ada left at 3,6 is still an invisible wall
```

In game this was already unreachable, because the controller checks
`npcOnTile` before calling `attemptMove` — so this is a latent inconsistency
rather than a live bug, and worth saying plainly. It is still worth fixing:
the helper is exported, and the next caller would have inherited the wrong
answer. The controller now also passes its own pinned clock through, so both
layers agree even at a phase boundary.

## The inverse sweep: flavour that could belong to any map (2026-09-15) ✅

Twenty-five of thirty-three quest givers never name the ground they stand on.
Before writing a rule about that, I checked whether it is a problem: it is not.
They talk about their herd, their trade, their ground — *"Beat two of them on my
ground"* — and the quest card names the map. A rule demanding place names would
have fired on three quarters of good content, which is the same over-strict
mistake as the keeper-naming check two cycles ago. Third time I have had to
learn it, so it is written down now.

What **is** a contract is narrower and it caught something real: a job that
happens on a **different map** from its giver has to say where.

```
these jobs do not say where: night-can: "wild beaten on the ice"
  (job at Drift Perimeter)
```

Fine until you count the grounds: the Drift Perimeter and the Long Light Depot
are *both* ice. "On the ice" is ambiguous between two places a hundred tiles
apart, so the label now reads **"wild beaten on the Drift Perimeter"**. The
check matches on shared significant words, because the labels are written the
way people speak — "wild beaten on the Stretch" for "Route 2 — Sandy Stretch",
"a 2600 champion on the Mesa" for "Highland Mesa" — and it has teeth: making a
remote job vague ("walk the high road") fails it by name.

## "Is it worth a walk?" answered where the car is (2026-09-15) ✅

The records board compares your best lap against what a terrain's wild would
send. The Inspector is the other place that question comes up — you are looking
at a car and deciding whether to breed on or go hunting — so its track result
now carries the same clause:

```
Grassland: flies — 1103px in 3s, top 546px/s. · wild sends 247
```

A 1103px car against a ground that sends 247 means the walk is wasted; the same
car against a ground that sends 900 means the grass is where the next jump is.
One helper (`wildSendNote`, from `wildSendByTerrain`) renders the clause in all
three places — the records board, the Inspector and (in its own phrasing) the
HUD chip — so they cannot drift apart about what a ground sends.

The e2e asserts it in the wild-pack journey, which is the only test that has
met a ground before it looks.

## You can decorate anywhere people live (2026-09-15) ✅

The Salt Road is the richest road in the game — thirteen people, five jobs, a
cookhouse and a workshop — and the player could buy eleven decorations and set
**none of them down out there**. Same for the Post, the ranch's own yard, and
all three road maps: decor spots had drifted into being a Starter Town feature
with a handful of exceptions.

Now every outdoor map with people on it takes at least one, and the rule is a
test:

```
nowhere to put anything: marrow_orchard (Marrow Orchard, 5 people)
```

The orchard was the one I missed by hand, and the invariant found it on the
first run — five people, a quest chain and a wild pack, and nowhere to put a
bench. That is the useful shape for this kind of check: not "is decor placed
correctly" (the passability sweep already does that) but **"can the player do
the thing here at all"**.

`Shade Spindle` and `Hay Hamper` reach the yard, `Trellis Arch` the switchback
and the Cut, `Meadow Lanterns` the Long Light Depot, `Salt Road Marker` the
Post and the Long Haul, and `Wildflower Bed` the orchard.

## A ledger of walk-ons (2026-09-15) ✅

The scenery sweep that found Pup Tam is a test now, and it works like a debt
register rather than a rule. Twelve people in the world have exactly one line
and nothing to click, and that is *right* for most of them — a hauler waiting on
weather, three drivers of the Salt Road, the watch who keeps the long light.
What the test guards against is the **unnoticed** one: an NPC added as a
placeholder whose dialogue never happens, reading as furniture.

So every one of the twelve is listed by id with a reason, and:

- a **new** walk-on fails with `new walk-on(s) with nothing to do: …` and the
  instruction to either give them a line worth walking up for or add them on
  purpose;
- an entry that **gains** a menu fails the other way (`now interactive, so drop
  them from KNOWN`), so the list cannot rot into a lie.

Props are excluded by construction — signs and "The …" objects are read, not
met — which is why the Ridge Vane and the Fuel Bowser are not on it.

Running the sweep also cleared two suspicions: Fitter Aubrey *does* explain the
Carrier's inspector in her one line, and the Cut's two jobs are given by Face
Boss Halg and Night Powder Peg, with Powder Monkey Bex left as the night shift.
Verifying is cheaper than "fixing" good content.

## The wild's number, next to the human one (2026-09-15) ✅

Two places had a number that meant less without the other.

**While walking**, the HUD's wild chip said how far the pack had come but not
what it would do to you:

```
WILD gen 2 · sends 361
```

**In the records board**, a lap was just a lap. Now it reads against the
alternative — what the wild on that terrain would hand you:

```
Hills   1543 px best · wild sends 361   Lhn4yi8zKRd2   Drive
```

Which is the whole "where you hunt matters" question in one row: if the ground
sends 361 and your lap is 1543, hunting there is a waste of a walk; if it sends
900 and your best is 700, it is the fastest way forward. `wildSendByTerrain`
takes the strongest *met* ground per terrain (two grounds can carry the same
terrain), and `wildSendNote` renders the clause or nothing at all — a terrain
nobody has hunted says nothing rather than zero.

## A sweep for scenery, and the pupil who teaches (2026-09-15) ✅

The intended job was to round out the Salt Road's Long Haul, which a stale
reading said had no interior — it has had Ada's Cookhouse and Raff's Workshop
for a while. So instead of building, I swept every map for **people who might
as well be furniture**: on-map NPCs with no menu, no job and no joint.

Most interiors have one or two interactive people and some flavour, which is
right. Two stood out. `town_schoolhouse` reported two people and *nothing*
interactive, and `Pup Tam` — a student at (2,4) with a single line about the
bench — turned out to be the only genuine scenery on the map.

She is the best possible person to give the lesson to. A pupil learning out
loud is NPC-led teaching from the other side of the desk:

- **"What makes a car fast, then?"** — *"Two paths, Axle says. Plates and
  wheels make the body… Cylinders and shafts and gears make the power, and
  power only counts if it reaches a wheel."*
- **"Why does the order matter?"** — *"Because the chain runs one way! An
  engine behind a wheel can't turn it — that's the mistake everybody makes."*
  That is the sim's actual rule, taught by a child who had to draw it forty
  times.
- **"Seen anything worth seeing?"** — a child's errand: walk the Highland Mesa
  and come back and tell her what you can see, paid out of her sweeping money.
  The cheapest way to point a new player at the Highlands is somebody who has
  never left town asking what is up there.

The schoolhouse e2e walks all three, and the errand lands on the quest card.

## Where you hunt matters, on a screen (2026-09-15) ✅

The encounter panel says which ground an animal came from. That knowledge died
with the race — walk away and the only place the fact lived was your memory.
The Record Barn now has a **WILD GROUNDS** table, under the records:

```
WILD GROUNDS · what each pack would send
Hills — The Switchback · wild gen 1 · sends 361 · best 1131   founder-class
Hills — Highland Mesa  · wild gen 6
```

Per ground: its terrain, its name, how many generations its pack has turned
over, **what an encounter would send** (the median animal, which is the number
that matters) and the best animal alive out there. Grounds whose pack a save
knows about but this session has not met list with their generation and no
numbers — the honest answer, since you cannot know what a ground sends without
having been there.

It costs nothing to maintain. Scoring a pack is real work (two dozen cars,
raced alone each), so `wildGroundRows` never scores: the renderer remembers
what a meeting already measured, and the table reads that back. `advanceWildPack`
now also returns its `representative`, which is why the table can say what the
ground *sends* rather than only what its champion does.

### Next
1. **Round out the Long Haul** — five people, three jobs, no interior.
2. **Sweep for keepers without a menu or a job**, the way the Vent Keeper and Sable were.
3. **Put the wild table's richest ground in the HUD**, so the fact is visible while walking.

## The local-giver pattern, as an e2e (2026-09-15) ✅

Two jobs used to be attached to outlying maps while being handed out in town,
and the Vent Keeper stood on the Mesa with nothing to say. The fix is now a
pattern, so it has a test that walks it end to end:

1. Prerequisites paid, walk up to the Keeper on the Mesa and press Z.
2. Her menu answers *"What does the ground want?"* — **"four wheels planted, two
   of them pulling, that is the shape the Mesa likes"** — which is the shape
   rules explained by the fiction rather than by the HUD.
3. Take the job; it lands on the card as **The Vent Line · Vent Keeper**.
4. The flag is read back out of the save, not just off the screen, so a job
   that draws itself without committing fails the test.
5. The landmark beside her — the Ridge Vane — can be walked up to and read.

The last step matters more than it looks: "a working you can walk up to and
read" is only true if a player standing next to it can actually open it, which
is the same class of check that caught two signs built inside a treeline.

## Is hunting a shortcut past the bench? Measured (2026-09-15) ✅

An encounter sends the pack's **median** animal, not its champion — so what a
ground can hand you is that number, and it decides whether a player can skip
the bench by walking to richer grass. Now that the three road maps have their
own terrain, all nine hunting grounds measured, median animal at five meetings
and at twenty:

```
Flat — the town paddock      418 → 1377
Grassland — the yard         450 → 1001
Grassland — Route 1          381 → 1089
Grassland — the orchard      527 →  991
Hills — the switchback       884 → 1128
Rocky — the cut              642 → 1156
Rocky — the Quarry           453 → 1131
Ice — the Perimeter          513 → 1622
Ice — the Depot              586 → 1291
```

**No ground is a shortcut.** Five meetings in, nothing anywhere on the map can
hand you a tier II animal — the strongest is the switchback's 884 against a bar
of 1220 — while breeding the loaner's own line reaches tier II in five
*generations* on the bench. Racing a hundred cars through a generation takes a
third of a second; meeting one wild animal takes a walk. So the bench is the
short road and hunting is the long one, which is the right way round for a
breeding game.

They do pay off differently, and not in the obvious direction: twenty meetings
in, the **Ice perimeter's** pack is the strongest thing on the map at 1622,
while the grass behind the house plateaus at 1001. The far ground is the rich
one, and your own paddock is where you breed rather than hunt.

Both halves are pinned in `tests/mid-game.test.ts`: every ground's fifth-meeting
median stays under tier II, and the ice's twentieth-meeting median beats the
yard's.

## The people standing on a ground give its work (2026-09-15) ✅

The Highland Mesa and the Long Light Depot both had people on them and jobs
attached to them — but in both cases the job was handed out somewhere else.
Sable kept the last roof before the perimeter and never asked you for anything;
the Vent Keeper read the wind on the ridge and had no use for you at all.

Two new jobs, given where they belong:

**The Vent Line** — Vent Keeper, Highland Mesa. A 2600 champion on Hills
terrain, paid in credits, feed and `PNEexlimSimR` (the four-wheeled reference
build). Her menu now answers the question the shape rules raise — *"High ground,
thin air. A car that wanders loses the line and never gets it back — four
wheels planted, two of them pulling, that is the shape the Mesa likes."*

**Cold Storage** — Depot Keeper Sable, The Long Light Depot. Four wild vroomon
off the ice, any four, paid in credits and feed. *"The lamps run on what the
drift gives up, and I am not fussy about how they look."*

Each ground also got a **working you can walk up to and read**: the Ridge Vane
on the Mesa, its post chalked with the week's readings, and the Fuel Bowser at
the Depot, with RETURNED scratched into the paint and then, in smaller letters,
*please*.

The quest-contract suite caught the first half of this before I wrote a word of
dialogue — `vent-line (quest-vent-line-accepted) is offered by nobody` — which
is exactly what it is for.

## Six biomes, six animals — measured (2026-09-15) ✅

The tier shapes raised a question worth answering with numbers rather than
opinion: if every pack drifts toward the same build, are the biomes just six
colours of one animal?

They are not. Breeding each ground's pack for forty generations and reading the
champion:

```
Grassland  2162   5w 5 driven  1 plate
Flat       3310   4w 4 driven  2 plates
Sand       2534   4w 4 driven  2 plates
Hills      3750   4w 4 driven  2 plates
Rocky      2154   5w 5 driven  1 plate
Ice        3234   4w 4 driven  2 plates
```

Two genuinely different answers settle out — the wide single-plate five-wheeler
on the open grounds, the two-plate four-wheeler on the rough ones — and the
spread in what a ground can produce is **74%** between the poorest pack and the
richest. So *where* you hunt matters twice over: the animal's build, and what
it is capable of. `tests/wild.test.ts` holds both halves (more than one shape
across the six, and a 1.25× spread between best and worst), so a future tuning
change that flattens the biomes into one animal fails the suite.

### The panel says where the animal came from

The encounter now names the ground and what it breeds:

```
The Switchback · Hills stock · the founders · this ground's best runs 1131px ·
win and it joins your Herd Book
```

A local population rather than a generic pack. (Adding a field to that line
broke an e2e that read the panel by field *position* — it finds the pack line
by what it says now, which is the right way to read a sentence that will keep
growing.)

## The same verdict wherever a car is described (2026-09-15) ✅

The Inspector got the circuit shape row last cycle; the paddock's own readout —
the one under the DNA field in Test Drive — was still just structure, power,
drive and the build's verdict. It now ends with the same answer:

```
STRUCTURE  4 plates · 2 wheels
POWER      2 engines · 2 shafts · 2 gears
DRIVE      2/2 driven · 130 pwr
Drive reaches every wheel.
CIRCUIT · The ground wants at least three wheels, two of them driven; this one
          has 2 wheels, 2 driven, 2 engines.
```

It takes its tier from the *terrain* being driven (`VENUE_TERRAIN` → venue →
Brand → tier), so it follows the circuit rather than a fixed number, and it is
tinted by `data-fits` — green when the build answers the ground, warm when it
does not. One sentence, `shapeReadout`, now used in both places.

### And the three keepers who never named their ground

Flavour, this time rather than a contract — the Guru of the Updrafts, the Lay
Foreman and the Keeper of the Long Light all greeted you without ever saying
where they were. Highland Mesa, the Canyon Quarry and the Drift Perimeter are
now in their opening lines, so all five arenas' keepers name the place they
defend.

## Hunting on the high road bred Grassland stock (2026-09-15) ✅

Going looking for content to fill the thin biomes turned up a bug instead, and
a worse one than a missing NPC.

**Three hunting grounds had no declared wild terrain.** `wildTerrainFor` falls
back to Grassland, and the maps with wild grass that were missing from the
table were exactly the ones off the beaten biomes:

```
mesa_switchback   The Switchback       8 wild tiles   -> Grassland
the_cut           The Cut              4 wild tiles   -> Grassland
long_light_depot  The Long Light Depot 4 wild tiles   -> Grassland
```

So hunting on the Highland switchback, in the Canyon's cut or at the
Perimeter's depot bred, scored and evolved **Grassland** stock.

**And the meeting itself used the wrong ground entirely.** `openWildRace` asked
`terrainForVenue(mapId)`, which is the *circuit's* answer and returns
"Grassland" for every map that is not an arena. That single line decided three
things at once: the terrain label on the panel, which of your cars
`bestOwnedDna` picks to race with, and the ground the race is actually run on.
A meeting on the ice was raced on Grassland, against a car chosen for
Grassland, under a label that said Grassland.

Both are fixed — the three maps declare their terrain (Hills, Rocky, Ice) and
the encounter asks `wildTerrainFor`, the ground the pack actually lives on. An
e2e now crosses the switchback until something breaks cover and asserts the
panel says **Hills**; a unit test requires every map with wild grass to declare
its own terrain, which fails loudly if a fourth is forgotten.

### The thinner point

That also re-balanced the world without adding a thing. Measured by people per
wild terrain, the thin biomes looked like they had one map each (Hills 3, Rocky
3, Ice 3) — but three of their roads were quietly counted as Grassland. With
the terrains fixed, each of those biomes has its own hunting ground with its
own evolving pack, which is the "own wild pack" the studio pass was looking
for. Content that already existed simply was not on the map.

## Does the wild answer the shapes? Measured (2026-09-15) ✅

The tier shapes were added so the climb would reward breeding a *build*, not
only finding a number. That raises a question the numbers can answer: can a
player simply hunt their way past a shape-blocked tier?

**Yes — and that is fine.** The wild is scored on time alone, so it drifts
towards whatever drives hardest, and it gets there quickly:

```
matured pack (20 generations)   4–5 driven wheels dominate, every tier answerable
founder pack                    spread 0–3 driven, median 2 — tier II is answerable
```

So the shape gate is not a wall against hunting. What it does is filter the
**random herd**, hard: 60% of freshly generated cars answer tier II, 39% tier
III, 12% tier IV and 4% tier V. A new player who never opens the blueprint
finds their herd mostly *cannot* answer the second Brand, and the wild — which
already holds two-driven animals from the founding pack — is a legitimate way
out. Two invariants now hold that line: the pack must never collapse to a
single build (immigrants and mutation keep putting new shapes back in), and
the demands must stay between 20% and 85% for tier II while the top rung stays
reachable, so nobody can soften the ladder into a pure score chase or harden
it into a wall.

## The Inspector answers the ground (2026-09-15) ✅

Tier shape demands are worth nothing if the player cannot see them while
breeding. The Inspector already lists every plate, wheel, engine, shaft and
gear; it now ends with the row that ties them to the circuit:

```
Circuit shape   Tier I asks nothing of the build — any car that rolls can answer it.
Circuit shape   This car fits the ground: at least three wheels, two of them
                driven, and it has 3 driven.
Circuit shape   The ground wants at least four wheels, three of them driven;
                this one has 2 wheels, 1 driven, 1 engine.
```

`shapeReadout(shape, tier)` is pure and unit-tested in all three registers, and
the tier comes from `nextCircuitTarget` for wherever the player is standing —
so the readout follows the circuit rather than a fixed number. The inspector
e2e asserts the row, which is how the tier I phrasing ("asks nothing of the
build") got caught when my first assertion only allowed the other two.

## One field, one name (2026-09-15) ✅

`gym_1` carries the name **Rustler Pasture** in its map chip, in the circuit's
venue list, in the quest line and in the badge it awards — but the Roundup
King welcomed you to *"the Roundup Grounds"*, and the roadside sign said the
same. Two names for one field reads as two places, so the alias is gone: the
sign, the keeper and a third mention in an early quest line all say Rustler
Pasture now.

Writing the invariant taught me something about invariants. My first version
demanded that **every** arena's keeper name their own ground out loud, and it
failed on three maps in a row — the Wreck Marshal, the Guru of the Updrafts,
the Lay Foreman. Those keepers simply talk about their schools and their
union rather than the place, which is a *style*, not a defect: an over-strict
check that fails on good content is worse than no check. The rewritten version
tests the thing that actually broke — the circuit and the map must agree on
what the arena is called, and a known alias must not appear anywhere. That one
has teeth (reintroducing "Roundup Grounds" fails it) and passes on the world
as written.

## The panel says what your best is (2026-09-15) ✅

The barn button already named the car it would record, but the *choice* is made
one row above it, in the focus strip — where nothing said whether the chip you
were on was actually your best. Now a line sits right there:

```
This is your best: preview-…-00015 · 1191.62
Your best is preview-…-00015 · 1191.62 — select it to record that one.
```

The selection defaults to the leader, so the first line is what a player sees
until they touch another chip; the second appears the moment they do. The arc
e2e walks both states.

## From tier II the ground asks what your car is made of (2026-09-15) ✅

The measured problem: a score bar alone rewards *hunting*. One lucky animal
off the grass took a herd from tier I to tier III in a single generation, and
11% of freshly generated cars clear tier IV outright. The climb had no reason
to touch the blueprint.

So from tier II each tier also demands a **shape**:

```
I    any car that rolls
II   at least two driven wheels
III  at least three wheels, two of them driven
IV   at least four wheels, three of them driven
V    at least four driven wheels and three engines
```

Calibrated against 500 random cars, so each rung is a real filter rather than
a formality: **53.6%** of random cars fail tier II, 35.4% pass tier III, 11.2%
tier IV, and only **3.6%** could ever answer tier V. (Later, in
`tests/mid-game.test.ts`, a different sample of 200 cars reads 60% / 39% / 12%
/ 4% for the same four rungs. Both are real measurements of different herds —
the test pins the *shape* of the curve, not one sample's decimals, and it is
the test's numbers that will move if the demands are retuned.) The demand is stated
before the race (*"It also wants at least three wheels, two of them driven"*)
and a car that is fast enough but the wrong shape is refused with its own
words, so the two kinds of failure ask for different work:

> **FEUD RACE · II** — Fast enough at 1900 against a bar of 1220 — but the
> ground wants a shape.
> The ground wants at least two driven wheels; this one has 1 wheel, 0 driven,
> 3 engines. Rival keeps the ground.

Tier I asks nothing at all, on purpose: that Brand is the lesson.

### The arc test's flake, three layers deep

The opening-arc e2e failed roughly one run in three at its worst, and each
layer was a different mistake — all of them the test's, none of them the
game's:

1. **Numbers parsed out of ids.** Chip text carries the car's id
   (`preview-muaybm4e-00070`) next to its score, so stripping non-digits over
   the whole string invented a number and picked an arbitrary car.
2. **The chip strip is not the leaderboard.** Picking "the highest-scoring
   chip" occasionally recorded a **919** car while the HUD read above the bar.
   The test reads the leader's id off the HUD and selects *that* chip — which
   is exactly what the sticky-selection trap means for a player, and why the
   panel now says what your best is.
3. **A stale read ending the loop.** The generation pill can still be showing
   the previous generation when the loop's own read returns, so the loop would
   exit on a score that then appeared to go *backwards* (633 after 1000). The
   final assertion polls now instead of reading once.

Three consecutive full-suite runs green after the third fix.

A fourth layer surfaced under parallel load: "record the leader once" is racy
by construction, because the leader moves between repaints — the loop, the
chip click, the label and the race each read at a slightly different moment.
The test now does what a player does: **record your best as it improves**, one
generation at a time, until the barn holds something above the bar. Three more
consecutive green runs.

## The ground says what it wants (2026-09-15) ✅

The circuit is a breeding target, and nothing in the game said so. A player
whose barn holds 973 who loses to a bar of 1000 has no way to learn that the
answer is *generations*, not a different car.

Now, the moment you take the fight option, the keeper tells you the terms
before the race card ever appears:

> **Meadow Elder**: Grassland I. The bar is 1000; your barn holds 973 — 27
> short. That is a breeding job, not a racing one.

`feudBriefing` is a pure function with three registers, all unit-tested:

- nothing in the barn — *"Breed one first."*
- short — the exact gap, and *"a breeding job, not a racing one"*
- enough — *"This one is yours to lose."*

It **replaces** the node's `Three, two, one... GO!` line rather than joining
it. The first version prefixed it and read like a lecture followed by a
countdown nobody asked for; the race card does its own countdown.

The screenshot is the whole idea in one box: the Elder's portrait, the terms,
and the quest line behind him reading *Next: Rustler Pasture — race Roundup
King to settle the feud*.

## Nothing the writer wrote goes unread (2026-09-15) ✅

The offer/thanks lines had sat unread for weeks while every contract test
asserted they were non-empty, so the question became: what else?

`questBeats` (the thing that fixed it) is now itself the contract — the audit
checks that each authored prose field is referenced *outside* the data module,
and the three voiced fields are checked by the presence of the call that speaks
them. Verified by mutation: stubbing out the `questBeats` call fails with
`nothing displays a quest's offer`.

### The giver was not named anywhere

Checking `giver` turned up a real gap rather than a dead field: the side-quest
card showed the title and the progress (`2/3 wild vroomon raced`) and **never
who gave it to you**. Rewards pay themselves, so going back is never
*necessary* — but the thank-you lines now exist, which means going back should
be *findable*. The card reads:

```
The Wrangler's Muster · Wrangler Jess      1/3 raced wild vroomon
```

Two screens, one written name, and a reason to walk back across town.

## Earned-only decor, and a button that says what it will do (2026-09-15) ✅

### Every earned-only item has to be earnable

Decor marked `earnedOnly` is hidden from the ranch shop, which makes a quest
reward the *only* way it can exist in a save. Add one without a job that pays
it and the flavour text describes furniture nobody can have — the same shape
of dead content as the written dialogue lines with no screen. There are two
(`bee-skeps`, `meadow-sign`) and both are paid by a quest; the audit is there
so the third one is caught by a test rather than by a player noticing a gap.
Verified by mutation: marking a purchasable item earned-only fails with
`salt-road-marker is earned-only but no quest pays it out`.

### The Record Barn button now names the car it will record

The selection sticks to whatever you last touched — seeding an imported
genome **moves it** — so a bare `🏆 SAVE` could quietly record a worse animal
than the one on the leaderboard. The button reads
`🏆 SAVE preview-…-00093 · 1119.88`, and turns gold when that car *is* your
best. Found a real bug in the first attempt: the label was looked up through a
`const` declared three thousand lines below the function that runs first, so
it sat in the temporal dead zone and every call threw. It queries the DOM now.

### Two test flakes worth naming

- **Reading numbers out of text that contains ids.** Car ids end in digits
  (`preview-muaybm4e-00070`), so `text.replace(/[^0-9.]/g, "")` over a chip
  invented numbers and picked an arbitrary car. The score comes from its own
  span now.
- **Fixed sleeps in a parallel suite.** The arc test passed alone three times
  and failed under four workers: 900ms per generation is generous on an idle
  machine and marginal on a busy one. It waits for the generation pill to
  actually move.

Both were the test's fault, not the game's, and both cost more debugging time
than the feature did.

## The writers' lines were never on screen (2026-09-15) ✅

Every side quest has carried an authored `offer` ("Nobody wrangles vroomon
without proving they can catch one...") and an authored `reward.thanks`
("Three races won off the rough. That's a wrangler.") since the quest layer
was built. A grep for either string across the whole renderer found **nothing
that displayed them**. The contract test asserted both were non-empty — so
they were written, checked, and read by nobody.

That is a specific and embarrassing shape of dead content: the checks passed
precisely because the lines existed, and nothing checked that they *arrived*.

### Putting them in the giver's mouth

`questBeats(world, run, npcId, npcName)` returns what a person should be
saying, in priority order:

1. **thanks** — a job you finished that they have not acknowledged to your
   face yet
2. **pending** — a job you took and have not delivered
3. **offer** — the next job, when their greeting has no menu of its own to
   say it with

The talking handler plays that line *before* their greeting (prepending, so a
greeting with options still shows its menu afterwards — appending would have
been swallowed).

### The reward lands the instant the work is done

The first live test looked like a failure: Jess said nothing. She had already
paid out — `tally` read `paid:wranglers-muster` — so there was nothing to
thank for. That is the right mechanic (nobody should have to walk back for
their money) but it meant the thank-you could never be spoken, since the
player is not mid-conversation when it fires. So the acknowledgement now waits
for the **next meeting**, tracked by `spoken:<quest>` so it happens once.

The screenshot is the whole point: Jess says *"Three races won off the rough.
That's a wrangler."*, the corner reads **JOB DONE · The Wrangler's Muster**,
and the wallet reads 120 cr — the writer's line, the job, and the money all
in the same moment.

### And the loop the feud actually asks for

Writing the arc e2e from scratch went wrong twice, in a way worth recording.
The feud is raced by the best car in the **Record Barn** — not by whatever the
herd currently holds — and the selection *sticks to whatever you last
touched*. Seeding the loaner moved it, so the test saved a 787 car while the
HUD showed a 1000+ leader, and lost the feud by 213. Both failures were the
test being wrong about the game, not the game being wrong, and the fixed test
now picks the top-scoring chip first — which is the loop a player runs: find
your best, record it, defend the ground with it.

## A correction: where the ladder actually starts asking (2026-09-15) ✅

Two cycles ago I wrote that "the first trophy is about breeding rather than
about the gift", on the strength of a measurement showing the loaner's line
crossing the tier I bar at generation 2. That measurement was of **one slot**,
not of the herd — and the sentence built on it was wrong in the way that
matters.

The number that decides whether the bars mean anything is what a *random* herd
can already do. Over 400 freshly generated cars on Grassland:

```
median 160   p90 481   max 1145
2% clear tier I (1000)   0% clear tier II (1220)
```

So the best of a new herd is already near tier I, and a first-sitting Brand can
be won by finding that car and putting it in the Record Barn. **Tier I is a
formality; the ladder starts asking at tier II, which luck never reaches.**
That is a defensible design — the first Brand teaches the loop, the second
teaches breeding — but it is not what I claimed, and the difference is now
pinned by a test that measures the distribution rather than a curve.

Two related corrections in the same pass:

- `tests/early-game.test.ts` now says out loud that it tracks `slot 0` (the
  planted loaner, and what `advanceRunState` keeps at the front) rather than
  "the herd's best". Those are different questions and I had been reading one
  answer as the other — twice, in two different files.
- A new e2e plays the whole opening arc with nothing seeded: the loaner,
  generations at the bench, then the Grassland feud won at tier I with no
  champion waiting in the Record Barn. It ends on the badge, not on a curse.

## The middle of the circuit, measured (2026-09-15) ✅

Two questions: does the climb (x1.22 a tier: 1000 / 1220 / 1488 / 1816 / 2215)
pace with what breeding can do, and is the last Brand earned or merely waited
for? Both answered by running generations against the home paddock's own wild
pack, scoring everything on Grassland.

**Hunting one animal each cycle** (the pack's middle animal — what an
encounter actually sends) and planting it:

```
T1@1  T2@5  T3@5  T4@27  T5@27      herd ceiling 2700
```

**From a pack champion, with no further imports:**

```
T1@1  T2@9  T3@15  T4@29  T5 never  ceiling 2046
```

So an engaged player never stalls — the whole Grassland ladder falls inside
about thirty generations, and the first two Brands inside five. And the last
Brand is genuinely **earned by staying in the grass**: a herd fed one good
animal and then left at the bench climbs to 2046 and stops, 169 short of 2215.

Worth noticing how tiers II and III fall in the *same* generation: a single
lucky animal off the ground (the pack swings between ~112 and ~1575) can clear
both at once. That is the hunting-lottery doing its job, not a pacing hole —
what the player is buying with those cycles is one good line.

### A trap that cost me an hour

`starter_town`'s wild pack is scored on **Flat** ground, while `gym_1` — the
Grassland arena — is Grassland. Comparing wild scores to herd scores across
two terrains produced confident nonsense: the same genome read as 1958 in a
pack and 1320 planted in a herd, which looked exactly like a simulator bug.
It is not: it is two different courses. `tests/mid-game.test.ts` says so at
the top, so the next person measuring pacing hunts and races on the same
ground.

## The early game, measured (2026-09-15) ✅

The first Brand is reachable in a first sitting, and the second one is not —
which turns out to be the hinge the whole circuit hangs on. Measured from a
fresh save with Robby's loaner planted as the top seed of a new herd, clear
sky, Grassland bar 1000:

```
best per generation   463  1118  1118  1118  1118  1119  1141  1141  1141 …
crossed tier I at     generation 2
plateau (12 gens)     1205
tier II bar           1220
```

The loaner alone (463) does **not** clear the bar, so the first trophy is
about breeding rather than about the gift — but two generations gets there
with room to spare. Then the line flattens at 1205, just under tier II's
1220: **one good import closes that gap, and nothing in the barn does.**
That is the moment the game wants a player to go and find genetics that are
not already theirs — a wild pack above founder stock, Oxide's road stock, or
a Champion string out of the herd book.

`tests/early-game.test.ts` asserts the whole shape: `best[0] < bar`,
`crossed` between 2 and 3, and the plateaus stay under tier II while staying
within 15% of it (a gulf would be a wall, not an invitation).

### What a generation actually costs

Measured in the browser, `Run Gen` at the real bench, timing from click to the
generation pill changing: **287, 309, 289, 294, 290, 276 — median 290ms.**
The on-screen race is a playback of the headless evaluation, so the wait is
three-tenths of a second, not three seconds. Scoring a generation is ~0.11s
of arithmetic in isolation, and that is guarded separately so ranch upgrades
that grow the herd can never quietly make the bench the slow part.

## A car's family, one tap from its parts (2026-09-15) ✅

The pedigree line in the Inspector now ends in a **🌳 Trace line** action:
it closes the inspector, opens the Heritage scene, focuses that same animal
and opens its line report. The reverse direction already existed (the tree's
own `🔍 Inspect`), so the two views are now a round trip —

    parts  →  🌳 Trace line  →  the tree, focused, line report open
    tree   →  🔍 Inspect     →  the parts, pedigree and all

The click path was already there but only reachable by tapping a node within
16px of its centre; the extraction (`focusHeritageNode`) means the button and
the tap do exactly the same thing rather than drifting apart.

### The labels were piling up

Opening the tree from a 27-generation herd showed the top row reading
`133 · 950.00 98.5` — champion labels drawn on top of each other. Columns are
~40px apart and a label is ~90px wide, so a label *always* overlaps its
neighbour. Labels are now placed **deepest first**, skipping any that would
land on one already placed, with a dark halo for legibility over the threads.
Recent animals win the collisions, which is the right priority — they are the
ones you are looking at — and the car you arrived for is named whatever
happens.

## Two invariant sweeps, and the two signs they caught (2026-09-15) ✅

Both of these are the same idea: stop checking the *shape* of the content and
start walking it.

### Every job's action must be inside the giver's own reach

Quest contracts already checked that a job pointed at a real map, that decor
existed, that reward genomes could drive. But "a real map" is not "a map the
giver can walk to". The contract now floods the real map graph from the giver
and requires, per objective kind:

- `catch-wild` / `win-wild` — some wild ground is in their reach
- `win-wild-on` — **the named ground has wild stock** and is in reach
- `visit` — the named map is in reach
- `champion-on` — the circuit actually covers that terrain, and they can reach
  an arena at all
- `generations`, `decor`, `release`, `champion-score`, `brands`, `dex-biomes` —
  the barn is walkable from where they stand

Verified to have teeth by mutation: pointing an orchard job at the ranch (no
grass) and a champion job at `Wetland` (no circuit) both fail it.

### Every keeper must be standing on ground you could walk to, at every hour

The existing collision check sampled five day-parts. That misses the
boundaries between them and never asked whether the tile was passable at all.
The sweep now walks the clock in hundredths and requires every on-shift
keeper to be on a tile that is **passable and reachable from the map's
entrances**. It found two signs, on the first run:

- `route_1: roundup-sign stands on tree at 19,5`
- `route_2: sand-sign stands on tree at 21,5`

Both were built inside the border treeline — which means both had dialogue
**nobody could ever read**, since interaction needs a walkable tile to stand
on and face them from. Both now sit beside the road facing it (16,5 and 18,5).
Worth noting the shape of the mistake, because it is easy to repeat: a sign is
placed by eye against the drawn map, and the drawn map's border of trees
looks like scenery rather than a blocker.

## A second pass along the arc (2026-09-15) ✅

Walking the three beats with the most systems stacked around them — the first
catch, the first Brand, the Grand Roundup — found two things.

### The first catch could be rained off

The lesson was scheduled by the weather. Racing Robby's loaner into the tall
grass **in an afternoon shower lost by 65px** — and the player has exactly one
car and no way to know that the sky, not their breeding, decided it. The first
lesson now waits for a clear spell (`encounterWeather`, unit-tested): the sky
over an encounter is clear until `tut-caught` is set. Same probe, same car,
same hour: **won by 607px.**

### The feud was named for the doorway, not the ground

Sweeping the Grassland from the Greensprouts' elder in Starter Town reported

  `Starter Town I swept! The circuit moves to II — bar 1220.`

— but the Grassland Brand is defended at *Rustler Pasture*, and the same race
accepted at the arena already read that way. The feud now resolves its venue
through `nextCircuitTarget` before naming anything, so the line reads
**`Rustler Pasture I swept!`** whichever door you came through. A circuit test
pins the resolution.

### Two things that looked like bugs and were not

- The feud result panel appeared to be **empty, showing a bare `2`** — it was
  the 3-2-1 countdown caught mid-beat. The result reads `FEUD RACE · I` /
  "Rival took second at 940. The ground is yours… for now."
- The Roundup's HUD read `BRANDS 3/5` while the finale announced five. That
  was my probe sharing one browser profile across seeded boots; the sequence
  is already covered by a passing e2e. Recorded because chasing either would
  have been a wasted afternoon.

### What the late arc looks like now

The wild panel in the grass (`arc-01-catch-rain.png`): two lanes drawn from
the real parts, `YOURS RWRWWR · 3 plates · 3 wheels · 3 driven`, the ground's
ceiling ("this ground's best runs 479px"), and the stake in one line. The
Roundup (`arc-04-roundup.png`): a trophy, "The five Brands are yours, and your
champion stands in the Record Barn", the champion's name and genome, and the
King underneath with his portrait.

## One car, read in the context of its family (2026-09-15) ✅

The Inspector now carries a **PEDIGREE** line beside the parts and stats:

```
PEDIGREE   by #102 + #116 · 37 siblings (best #123, 1177.36)
           · 9 descendants (best #110, 1233.99)
```

Its two parents, how many siblings it was raised beside (with the best one
named and scored), and what it went on to produce. A founder honestly reads as
`founder stock`.

### Two things this caught

- **The kin line first read `by #146 + #148 + #65 + #74 + #75 + #80 + …`** —
  nine parents. The graph unions ancestry edges out of the genealogy map,
  which is exactly what the *tree canvas* needs, but a pedigree wants the two
  animals it was actually bred from. The caller now passes the car's own
  parent pair, and a unit test pins it.
- **The evolution guards were failing the suite on a 5-second default
  timeout** — they measure a herd over five seeds, which is deliberately heavy.
  They now declare their own timeouts. (Worth noting because I nearly
  mis-diagnosed it as a statistical flake and "fixed" a claim that was fine.)

Also: the Inspector's stat rows now pluralise (`1 plate · 5 wheels`, not
`1 plates`).

## A fresh-playthrough pass (2026-09-15) ✅

With this much added *around* the opening, it was worth walking it again from a
genuinely empty save (`localStorage.clear()`) and reading what a new player
actually sees. Screenshots in `/tmp/vshots/pt-*.png`:

1. **Title** — only NEW GAME, CONTINUE correctly hidden.
2. **Opening** — the monologue, the name step, the wake line personalised:
   *"Somewhere, Nell's breakfast smells like it's already decided."*
3. **The kitchen** — Robby with his portrait, two options, and the quest line
   *"Robby's in the kitchen — follow the call."*
4. **The reveal** — the story walks you into the **yard** through the new
   `goto:` hand-off, and the quest advances to *"The tall grass on the left
   grazes wild vroomon."* (the bug where the ranch quest never advanced is
   fixed and visible here).
5. **The yard** — porch, paddock, grass, the lesson.

Nothing read wrong, which is the point of taking the pass rather than assuming
it.

## Rain is a defence modifier, not a fitness change (2026-09-15) ✅

The rule from the weather work — *weather may never move a measured number* —
is now the whole design of how it touches the campaign. A circuit's bar is the
ground's demand, so **bad weather raises the bar** (a shower +12%, a gale +7%,
mist +3%), while **a champion's recorded score was set in the dry and does not
move**. So:

```
clear morning:  Grassland III   you: 1550 (Lhn4yi8zKRd2)   clears 1488 by 62
afternoon shower: Grassland III   you: 1550 (Lhn4yi8zKRd2)   short by 117 · bar 1667  [go]
```

The same car, the same circuit, two skies. The race card says which way the
sky cuts — *"the bar is 1667 (raised 12% by the shower)"* — and the ledger
states the modifier above its rows, so the number you are reading is always
the number you would face.

Every other caller passes no defence, so the lab, the heritage tree, the
records and **every pacing measurement in the suite are unchanged** — which is
exactly what the tests assert, tier by tier, under a clear sky.

## The Heritage tree reads like a pedigree (2026-09-15) ✅

Tapping a car in the family fabric has always traced its line into one
sentence. It now opens a **LINE REPORT** underneath:

```
LINE REPORT · 3 LINKS
gen 0   #12    ─
gen 1   #30    420.11 pts
gen 2   #55    1033.80 pts  ★
Herd best: 1:1167.45 → 2:1167.45 → 3:1322.20 → 4:1207.43
           · best on this line: #55 (1033.80)
```

Every link, its generation, whether it was a champion of its generation, and
the score the herd recorded for it — plus the herd's own best across the last
twelve generations, so a line can be read against the curve it came out of.
Older links honestly read as `—`: only the latest generation still carries
scores, and inventing them would be worse than admitting it.
`src/renderer/heritage.ts` gained `lineReport` and `describeLine`, both pure
and unit-tested.

## Grass you cannot walk to is a mechanic that does not exist (2026-09-15) ✅

Two invariants about the wild's own precondition:

- **No map fences off its tall grass.** Encounters only fire on vroomgrass, so
  a patch the player cannot reach is a mechanic that isn't there.
- **Every outdoor ground with a wild pack has reachable grass.** Checked
  against the wild's own terrain table, so a ground that names a pack but has
  nowhere to meet it is caught. Interiors are excluded on purpose — the
  arenas name a terrain so their circuit agrees with the wild's table, but no
  encounter happens indoors, and the check found exactly that subtlety while
  being written.

## Every far road has someone on after dark (2026-09-15) ✅

The night shift is now a habit of the whole island rather than two men at one
waystation. Each far road has a keeper who exists **only between dusk and
dawn**:

- **Signal Lorn** minds the cable lamps on the Switchback: *"the lamps make a
  false summit out of nothing, and the wind comes down the gullies cold. Cars
  that grip do fine. Cars that don't, I log."* Pays for *The Lamps Of The
  Mesa*.
- **Night Powder Peg** at the Cut: *"no blasting after dark — that's the rule
  and I'm the reason it exists."* She counts what comes off the spoil heap and
  what gets left on it, and pays for *Night On The Spoil*.
- **Night-picker Sib** works the orchard's late rows, where the wild stock
  comes down to the windfalls. Pays for *The Late Rows*.

That makes four night watches in the world (with Pell on the waystation street
and Vane at the fuel shed), three new jobs, and the day cycle meaning
something in every biome: **at noon these roads are empty; after dark every
one of them has somebody on it.**

## Weather, and where it is allowed to matter (2026-09-15) ✅

The sky now follows the hour, using the same day slots as the shifts and the
day tint — **clear at dawn and morning, a shower in the afternoon, a gale at
dusk, mist by night** — and it is not just decoration:

- **A shower cuts the grip a wheel can put down** (0.72) and takes a little
  drive with it. A gale costs more drive than grip; mist costs a little of
  both. The same two cars can swap places depending on the sky, because a car
  that spins its drive away and one with drive on every wheel that is touching
  the ground are affected differently.
- **The wild race names its sky**: `shower: Wet grass: grip is what you
  brought, not what you asked for.`

### The rule that keeps it from being a bug

This is an evolution simulator: a fitness that drifts with the wall clock
would make a breed line and a circuit bar mean something different every time
you looked at them. So **weather applies where a race is already a one-off —
the wild encounter you are standing in — and nowhere else**. The lab, the
heritage tree, the circuit and your own test drives always run clear, and the
sim's weather parameter defaults to neutral, so every existing measurement in
the test suite is unchanged.

### Two things this caught

- The harness pins morning for determinism, and morning was initially *wet* —
  so two catch tests started losing races they used to win. Weather now
  follows the day's own slots (mornings clear), which is both tidier and
  matches the fiction.
- The API surface declares `window.vroomon` in **three** places (renderer,
  preload shim, preload); TypeScript merges them and demands identical
  shapes, which is how the last one gets found rather than shipped.

## The ledger is a work list, not a report (2026-09-15) ✅

Every ledger row you are *short* on now carries a **go** button: it sets the
paddock to that circuit's terrain with your best car on the line, opens Test
Drive, and says what the circuit asks — *"Paddock set for Grassland —
Lhn4yi8zKRd2 on the line. This circuit asks 1488."* Breeding past a bar starts
with knowing exactly which bar and with which car, so the screen that tells
you also takes you there.

## Every arena has a back room (2026-09-15) ✅

Both named venues now have somewhere behind the racing:

- **The Tack Room** at Rustler Pasture, where **Groom Millie** keeps the
  Reds' straps and has an opinion about finishes: *"a champion isn't a fast
  car, it's a fast car that still finishes — and I've seen more of them ruined
  in the last hundred metres than in the first."* She pays for *A Finisher's
  Number* (1,200 on the flat) and will tell you what ruins a car at the end:
  the blueprint, read before you race.
- **The Weighbridge** at the Salt Road Post, where **Weighmaster Tuck**
  weighs freight, cars and excuses, and pays for *Signed Off At The Scale*
  (two wild beaten on the Stretch).

Both are reached through a door in the arena's west wall, and the "giver
stands where the work can be done" invariant had to learn to walk: Tuck is
two gates from the nearest grass, which is fine, so the check is now a
bounded three-gate walk rather than a glance at the neighbours.

## Jobs have to be possible where they are handed out (2026-09-15) ✅

Two more invariants, aimed at content that is *possible to ask for* but
impossible to do:

- **Every objective points at ground that can provide it.** A job to beat wild
  vroomon on a map with no tall grass cannot be completed, so each
  `win-wild-on` objective must name a map that actually has vroomgrass.
- **The giver stands where the work is.** Same bug one step removed: a giver
  on a map with no grass asking for wild wins has to be at least one gate from
  some. Both pass today — which is the point of asking, not the proof that
  they always will.

And decor is now checked for **reachability**, not just walkability: a piece
parked in a sealed pocket is a piece nobody will ever see. Same flood-fill the
NPC check uses, run from each map's own entrances.

## The ledger: bars against bests (2026-09-15) ✅

The Record Barn held per-terrain bests and the circuit held a rising bar per
biome, but nothing put them side by side — so a rancher could not tell whether
their champion still cleared the ground they were about to race. The Barn now
opens on a **LEDGER**:

```
Grassland III   you: 1400 (Lhn4yi8zKRd2)   short by 88 · bar 1488
Sand I          you:  400 (RuAp2owjBaqK)   short by 900 · bar 1300
Hills I         you: —                     no run yet — bar 1150
DEFEND          2 circuits would turn your best away        breed faster
UNRUN           3 circuits never raced
```

Every row states the tier you would face, the score that asks for, your best
and the car that set it — and the margin, green when you clear it and red when
you do not. `src/renderer/ledger.ts` is pure and unit-tested, and it reads
both sources honestly: a lap board entry *and* an enshrined champion count as
cars you could still send.

**Found while building it:** the ledger first rendered with a default world
and never refreshed, because it was wired to the *boot* path rather than the
Barn's own paint. It now renders from inside the records board, so every path
that paints the barn refreshes both halves together.

## The watchman was right about the dark (2026-09-15) ✅

Two NPCs claim the wild runs better after dark — Pell (*"the wild's quicker at
night, if you believe the haulers"*) and Vane (*"same pack, colder air, and
they run it better"*). It was flavour. Now it is a rule: **a meeting after
dark costs the wild pack two generations instead of one**, so the animals you
meet at night have been bred harder.

One definition of night is shared by the wildlife, the window lights and the
shifts (`isNight` reads the same day clock), so the fiction and the mechanics
cannot drift apart. Tests cover both the pack turning over twice and the
clock agreeing on when night is.

## The road landmarks have offices (2026-09-15) ✅

Both far-road landmarks now have a roof and a keeper in it:

- **Salt Road Freight** — a bay on the Stretch where **Clerk Nessa** reads
  herds like ledgers: *"a herd that never turns over is capital sitting
  still."* She pays for *A Line That Moves* (ten generations on the bench).
- **The Fuel Shed** at the Long Light Depot, staffed **only after dark** by
  **Stoker Vane**, who explains why nothing good happens on the ice at night
  and everything fast does — and pays for *The Night Shift* (one wild beaten
  on the ice).

Both are reached from their road's own door, and the invariants that have
been earning their keep all cycle (dead doors, door loops, trigger tiles,
building clusters, reachability, dialogue links) had to pass on every new
tile and gate before this shipped — which is why the second one took minutes
rather than an afternoon.

## The campaign spine was six generations long (2026-09-15) ✅

A bot rancher with one policy — run generations on a biome until its circuit
bar falls, then move to the next — cleared **all five Brands in six
generations**, about thirty seconds of play. The whole spine of the game was a
formality, because the tier I bars (600–840) sat *below* what a random 32-car
herd already scores on those grounds (750 / 1,145 / 1,097 / 1,052 / 875).

The bars are now set between two measured bounds:

- **above** what a random herd manages on that ground, so a Brand falls to
  breeding rather than to the starting population, and
- **below** what a herd reaches even on a *poor* seed (measured low-water
  marks of 1,271 / 1,673 / 1,519 / 2,068 / 3,239), so the opening circuit is
  a real ask and never a wall.

The bot now takes **94 generations** for the five Brands (9 / 20 / 25 / 38 /
2), which is an evening of breeding. `tests/pacing.test.ts` keeps both bounds:
the bars must beat a random herd and stay under what the ground produces, and
a bot campaign must take more than a handful of generations and less than a
week.

### What this means for the ladder

Tier I is the campaign's requirement — one Brand per biome — so it is
calibrated to be reachable on any seed. The tiers above it are a **title
defence**: the bar rises 1.22× per sweep, the record books keep the scores,
and a wall there is a challenge rather than a dead end. The guard says so
explicitly rather than pretending every tier is a promise.

## Three invariants that reached across systems (2026-09-15) ✅

The bugs worth hunting now live *between* features, so these three look for
agreement between subsystems that were written separately:

- **The circuit's terrain table and the wild's must agree.** They describe the
  same ground from two directions, and a pack selected on one surface but
  raced on another is a silent mismatch.
- **Every piece of decor sits on walkable ground** — in the meadow *and* in
  each per-biome spot. It found four pieces parked inside the town's tree
  line (`duck-pond`, `salt-road-marker`, `meadow-lanterns`, `roundup-bell`);
  they now line the meadow fence, which is what their flavour text always
  claimed.
- **Every rival races a car that actually moves.** A trainer race drives a
  DNA derived from the node's id — which was pure luck, and **Tez drew a car
  that managed 0.1px** while **Sprout's managed 38px**. A rival you cannot
  lose to is not a rival. Rival cars are now **authored** (`rivalDna`), and
  the invariant refuses to let one be a dud: Hook races the 1,433px car, Tez
  the 719, Vicky the 454, and Sprout a rattletrap that at least runs.

## Night changes who is about (2026-09-15) ✅

The day cycle used to be decoration — a wash over the map and a reason for
people to stand somewhere else. Now it changes what you can *do*:

- **People can have shifts.** An NPC's `hours` is a phase range that wraps
  (`from: 0.78, to: 0.12` is dusk through dawn), and someone off shift is
  simply **not there** — not drawn, not interactable, not in the way. **Pell
  the watchman** works the waystation street only after dark, and the job he
  offers (*Work The Dark*: two wild vroomon off the Stretch) can only be
  taken at night.
- **Windows light up.** Every building and door tile carries a small warm
  pane whose brightness follows the same clock as the daylight (on through
  dusk, out after dawn), so a town at night looks occupied rather than
  painted.

### And an invariant for buildings

`every building cluster has a door` — a facade with no way in is a promise
the map doesn't keep (the same family as the dead doors and the door loops).
It found nothing to fix: the Long Haul's two buildings and the town's two are
the only ones with doors, and each cluster has one.

## Beauty pass 3: rooms lit, a square furnished (2026-09-15) ✅

- **Rooms have lamps.** Every interior draws a warm pool of light in the
  middle of the room that breathes slowly (0.88–1.0 over about two seconds),
  so a room is lit rather than merely drawn. Pure function, unit-tested, and
  scaling with the room's size.
- **The town square is furnished.** Market stalls and a well head, drawn with
  tiles the world already had (counters are walkable, so no path is blocked,
  and the walkability invariants still pass).

## A pacing audit, measured (2026-09-15) ✅

Balance can't be reasoned about in this game — what a herd can do depends on
the simulation of a given terrain — so the campaign is now measured, and the
measurements are guarded.

**What was measured** (60 cars, 120 generations, mutation 0.3, per terrain):

| terrain | tier I | tier V | generations to tier V |
|---|---|---|---|
| Grassland | 600 | 1329 | 35 |
| Sand | 660 | 1462 | 6 |
| Hills | 720 | 1595 | 21 |
| Rocky | 780 | 1728 | 38 |
| Ice | 840 | 1861 | 10 |

**What that found and changed.** At a tier growth of 1.28 the Quarry's tier V
bar was 2,094 against a Quarry run that topped out at 2,068 — the grind only
got harder from there, forever. Growth is now **1.22**: every terrain's five
tiers fit under its own ceiling and tier V arrives inside 38 generations
rather than never.

**And what it honestly can't claim.** Re-measuring on a second seed gave Sand
1,673 and Rocky 3,224 — the *starting population* decides more than the dirt
does, so "the ceiling" is a range, not a number. The guard therefore states
the weak claim (a bar must sit under what its ground has *demonstrably*
produced) rather than a strong one that would fail on noise, and the real
measurement runs opt-in (`VROOMON_SLOW_TESTS=1`). A bar above one seed's
result is a grind, not a dead end: the herd keeps breeding, and every
generation can find a better car.

**The ranch economy**, for the record: the full upgrade catalogue costs 38,190
credits and a five-terrain campaign earns roughly 28,000, so "buy everything"
is a mastery goal rather than a mid-game wall. That's a deliberate shape, not
a bug — but it is a judgement call, and the numbers are in
`tests/pacing.test.ts` for whoever wants to argue with them.

## Starter Town has rooms now (2026-09-15) ✅

The town's two buildings were facades with nothing behind them. Both open:

- **The Schoolhouse** — where **Professor Axle** actually works now, which
  finally makes the main quest's line (*"Talk to Professor Axle at the
  schoolhouse"*) literally true. **Pup Tam** sweeps up in exchange for
  lessons and knows the important one already: *"the bench doesn't care how
  fast your car is, only how fast the next one is."* Axle's whole explain
  thread (Herd Book, breeding a champion, farewell) moved in with him.
- **The Supply Store** — **Storekeep Bram** sells grain, grease and gossip,
  and pays for *Word From The Switchback*: walk the cable station above the
  Mesa and tell him what the cable hand says about light cars.

### Two more invariants, and the nine bugs they found

- **You land inside a room, not on the way back out.** A gate that lands you
  *on* another gate is a door you cannot stop falling through. The
  schoolhouse and store both did it — and then the invariant found **eight
  more across the whole world**: every mutual road gate (town↔ranch, town↔
  orchard, route↔arena, biome↔biome, waystation↔route) landed on its
  partner's exit tile, so walking a road and continuing in the same direction
  bounced you straight back.
- Moving Axle into the schoolhouse was done by **following his dialogue
  thread**: the explain nodes he points at had to move with him, or the
  conversation would stop dead (the link invariant added last cycle made that
  mechanical rather than hopeful).

## People have days, and memories (2026-09-15) ✅

NPCs were statues with a paragraph. Now they have **routines** and
**memories** (`src/renderer/world/routines.ts`, pure and unit-tested):

- **They move with the day.** Wrangler Jess works the market square in the
  morning, takes the gate road in the afternoon and drinks by the well at
  dusk. Picker Sprout works the rows and races in the afternoon. Cook Ada is
  at her stove by day and at the door in the evening. A routine only
  describes what changes — a missing slot borrows from earlier in the day, so
  a night watch stays where the evening left it.
- **They know you.** Standing is derived (`new` / `known` / `champion`) from
  Brands, Herd Book size and the Hall of Fame, and an NPC can carry opening
  lines per tier: one Brand gets *"Back off the grass, I see"*; three gets
  *"the rider with a Brand and a champion in the barn"*.
- **Rivals remember the last race.** A trainer race records the result
  against the rival's name, and a rival with `after:win` / `after:loss`
  lines opens with it: *"You beat me on my own road"* or *"Told you the Long
  Haul's quick."*

### The trap this set, and the fix

Moving people made **every position test time-dependent** — a suite that
passes at 9am and fails at noon is worse than no suite. The world now carries
a **pinned hour** (`timeOverride`, saved with everything else), the renderer's
clock, the day tint, the routines and the controller's interaction all read
the same source, and the e2e harness pins morning. The feature's own test
walks the same street at dawn and at dusk and proves the difference — which is
only possible *because* the hour is deterministic.

## The save audit now covers every store (2026-09-15) ✅

The journey e2e already proved the world, the herd and the quest tallies
survive a reload. It now also **enshrines a car in the Hall of Fame** (which
means running a generation first, because the Hall reads the ranked herd) and
**buys a ranch upgrade**, then reloads and asserts the Hall, the upgrades and
the records board all came back. Four separate stores — world, run, records,
hall — are checked in one session's worth of play.

## A landmark for every far road (2026-09-15) ✅

Each leg of the circuit now has a place with a face on it, off its biome's
map and reachable from town:

- **The Switchback** (Hills) — a cable station on the Mesa face. **Cable-hand
  Juno** explains why the Hills eat light cars and logs a climb for 900 on the
  Mesa; **Tez** races anything with a fast car and a point to prove.
- **The Cut** (Rocky) — a rock cutting with a pool and spoil. **Powder Monkey
  Bex** explains what survives rough ground (weight and a frame that doesn't
  fold); **Face Boss Halg** pays for a thousand on rock.
- **The Long Light Depot** (Ice) — the last roof before the perimeter, with
  fence lines and ice lanes. **Depot Keeper Sable** explains that ice has no
  grip, so a spinning wheel loses the run, and pays for 1,100 on the
  Perimeter; **Hauler Wren** hauls salvage twice a week in a heavy frame that
  finishes.

Each is chained behind the town board, each has its own wild pack on its own
terrain, and each one back-links to its biome map so nothing strands you.
Champion jobs now read their ground in the HUD (`0/900 pts on the Mesa`), not
just a bare score.

## Rooms behind the waystation's doors (2026-09-15) ✅

The Long Haul's two doors were painted and promised nothing — a door that
leads nowhere is the map lying to the player. Both now open onto real
interiors:

- **Ada's Cookhouse** — counters, a stove, a table, warm light, and two
  people: **Pot-washer Nim**, who turns culled stock out past the fence and
  pays for the same (*Out Past The Fence*, the first shipped use of the
  `release` objective), and **Hauler Quill**, who explains why a frame that
  holds matters as much as raw speed.
- **Raff's Workshop** — benches, scrap and a welding apprentice: **Cogs**,
  who will say the power path back to you and pays for a car that runs 800 on
  the flat.
- Two more jobs in total, from **Roundup King** (*Brands On The Board*, the
  last unused objective kind, `brands`) and the two rooms.

### Two more invariants

- **No dead doors.** Every `door` tile must have a transition on or beside it.
  It found the Long Haul's pair immediately and passes now.
- **Every objective kind is exercised by a real quest.** A declared kind no
  quest uses is a feature-shaped hole that can rot unnoticed — this is how the
  `brands` and `release` kinds got homes.

The wild chip is also hidden on interior maps, where there is no wild to
report.

## The Long Haul: a road stop, and five unreachable doors (2026-09-15) ✅

A new area on the Salt Road — a cookhouse and two workshops between Route 2
and the Highland Mesa, with its own **Sand** wild pack, a pond, fence rows and
**four people**:

- **Cook Ada** hears everything on the lane (and wants proof: 1,100 on the
  Stretch, once the orchard's cutting is paid).
- **Drover Holt** explains the trade counter out loud — sell what you catch,
  buy stock off ground you've walked — and pays for **Four Grounds**, a job
  that counts *biomes in your Herd Book* using the new specimen provenance.
- **Stoker Raff** explains the power path (cylinders, shafts, gears, and which
  wheel actually gets drive).
- **Hook** races anything that stops for bread, on a Long Haul special.

### The bug this flushed out, five times over

A new invariant now asserts that **every transition sits on a tile you can
stand on**. A door keyed to an impassable tile is dead — the player can never
step there, so the door does nothing. It immediately found five:

1. Route 1's **walk back to town** was on the border tree: you could walk into
   Route 1 but not out the way you came.
2. Route 1's **gym gate** was on the border tree as well.
3. Route 2's **gate to Route 1** was on the tree border.
4. Marrow Orchard's **hedge gate** — mine, from the previous slice — was on
   the tree border.
5. The town's **north lane** had nowhere to stand, so the orchard's town gate
   was unreachable.

And one worse: Route 1 carried **two transitions under the same key**
(`"18,5"`), so the second silently replaced the first and the Salt Road gate
simply did not exist. All six are fixed, the trigger-tile invariant is
permanent, and `defines transitions on the expected map edges` was updated to
match the corrected gates.

## A save audit, and the herd it saved (2026-09-15) ✅

A full-journey e2e now walks a session — catch a wild vroomon by racing it,
finish a job, spend the reward on meadow decor — and then reloads twice,
asserting that **nothing** was lost: rancher, map, Herd Book and its
provenance, every tally (overall wild wins, per-biome wild wins, paid jobs),
quest flags, wild packs and their generation, wallet, feed, and the herd.

It immediately caught a bug of my own making, and a bad one: **a finished job
could wipe the herd.** Settling a quest pays the rancher, which writes the run
state — and the boot settled quests as soon as the *world* had loaded. If the
herd had not loaded yet, that write used the renderer's still-empty default
run and saved it over a real herd of 100 animals. The boot now waits for both
the world and the herd before paying anything out.

## Beauty pass 2: the world keeps time and remembers feet (2026-09-15) ✅

- **A day.** `dayTint()` cycles dawn → morning → afternoon → dusk → night over
  **four minutes**, laid over outdoor maps at 3-20% strength (interiors keep
  their own light). Light enough to read through, present enough to notice.
- **Paces.** The ground keeps the last few footsteps: small puffs that bloom
  and fade in about a third of a second behind whoever is walking.
- **Breath.** NPCs bob a single pixel on a per-NPC phase, so a standing
  villager is alive rather than a decal.

### The unit bug this flushed out

Every one of these is driven by the renderer's clock, which is
`performance.now()` — **milliseconds**. The first version of the ambience
layer treated those numbers as frames: the day cycled every **5.4 seconds**,
footsteps vanished in 22ms, NPCs jittered at 22Hz, and motes and ripples
moved ~1000× too fast. It looked *fine in stills*, which is exactly why the
tests now assert **rates**, not just shapes: a day lasts minutes (>120s), a
mote crosses fewer than 30px per second, and the same day-phase holds across
five-second samples.

## The Herd Book keeps notes (2026-09-15) ✅

A sixth hub scene (`📖 Dex`). The Vroomdex used to be a bare list of DNA
strings — a specimen off the ice read exactly like one off the home paddock,
and nothing remembered what it ran. Now every catch and every purchase
records **where it came off, what it ran, and when**:

- `the Canyon Quarry · 1433px · just now` · `BOUGHT`
- `the Shoddy Ranch paddock · 719px · 1h ago` · `CAUGHT`
- and specimens from before the notes existed read honestly as
  `caught before the book kept notes`.

The header reads the collection back: **N specimens from M biomes · best wild
animal runs Xpx**. Notes are pruned with the Herd Book's own 200-entry cap, so
they cannot outlive their specimens, and selling one at Oxide's counter drops
its note with it. `src/renderer/world/specimens.ts` is pure and unit-tested
(recording, pruning, summary, and age in words).

Found while building it: the Trade and Dex panels were styled with colours
meant for a dark panel, but the console cards are **paper** — light ink on
cream, unreadable. Both now use the ledger's own variables.

## Quest contracts: the content is now checked, not trusted (2026-09-15) ✅

Writing jobs is easy; breaking them is easier. `tests/quest-contracts.test.ts`
reads the **shipped maps and catalogs** rather than a fixture and asserts that
every job can actually be played:

- **Some dialogue sets every accept flag** — a quest nobody offers is dead
  content.
- **Every giver is standing on the map their job names.**
- **Chains only reference jobs that exist**, and no chain loops.
- **Every genome a job pays in can actually drive** (a short race on the flat).
- **Every decor a job pays in exists, and is `earnedOnly`** — a reward the
  shop also sells is not a reward.
- Every per-biome objective names a real map, and every errand names ground
  something actually leads to.

It found four real content bugs the moment it ran:

1. **Fitters' Errand was offered by nobody** — the quest existed, the giver
   never did. Fitter Ollan now stands in the town square with the offer (and
   a line explaining the ranch shop).
2. **A giver name didn't match its NPC** ("Oxide, the road trader" vs
   "Oxide"), so the job looked unmatchable.
3. **The Quarry prize was a dud.** `UoZzJLj1FOFC` was a good car when it was
   chosen, but the decoder has changed twice since and it now manages 128px in
   a three-second race. It pays `A9gpwYaIPmdg` (1433px) instead.
4. **The beekeeper's skeps were for sale in the shop**, which defeats paying
   them as a reward. They are `earnedOnly` now, like the range sign.

## Jobs that chain, and a reason to ride out (2026-09-15) ✅

Eleven jobs now, and the far biomes finally have work on them:

- **Chains.** A quest can name a `requires` (the job that must be *paid*
  first). Locked follow-ups stay off the board entirely, and a save from a
  build where the chain didn't exist cannot have accepted one early. Jess's
  muster unlocks *A Name On The Board* (eight wins), and it unlocks the four
  new **biome jobs**.
- **Jobs about a specific ground.** A new objective kind, `win-wild-on`,
  counts wild races won *per biome* (`wildWins:<mapId>`), so *The Salt Road
  Wager* (two on the Stretch), *Thermals And Stone* (two on the Mesa), *A
  Shift In The Quarry* (two in the Quarry) and *The Perimeter Watch* (two on
  the ice) are about beating the wild where it lives — the wild packs you
  seeded per biome now have a reason to matter. Nine wins on the road will
  not count toward any of them, and the tests say so.

Each far-biome job is offered by the host who already lives there (the Wreck
Marshal, the Guru of the Updrafts, the Ringleader, the Frost Baron) through a
new dialogue option, so no new faces were needed to give the late game
something to do.

## Ambient life, and water that moves (2026-09-15) ✅

A still map reads as a picture. `src/renderer/world/ambience-layer.ts` is a
pure function of `(mapId, tick, view)` — no draw-time randomness, so a frame
is reproducible and the whole layer is unit-tested without a canvas — and it
gives each biome its own weather:

| where | what drifts |
|---|---|
| town, ranch yard, Route 1 | pollen motes |
| Marrow Orchard | petals |
| Route 2, Rustler Pasture, Highland Mesa | dust |
| Canyon Quarry | grit |
| Drift Perimeter | snow |
| any interior | dust in the air |

Motes have their own drift vector, wobble and pulse, and wrap around the
window, so the air never thins out. The **pond now moves**: water sits in the
baked tile layer (static by design), so staggered glints are drawn over it
each frame at per-tile phases — a couple of short lines per tile, and the pond
stops being a blue rectangle. Tests cover the weather table, mote determinism
and in-bounds wrapping, and that the ripple phase differs per tile.

## Oxide's trade counter: the herd book pays (2026-09-15) ✅

A fifth Pocket Ranch scene (`🧺 Trade`) where specimens become credits and
credits become blood:

- **Sell** any caught specimen. It is priced by a short race on the flat
  (`sellPrice = score / 4`), so the Herd Book stops being a list you can only
  add to — duplicate wild catches are worth something now.
- **Buy** road stock. The shelf is drawn from the **wild packs in your save**,
  which means it only offers ground you have actually walked, and its stock
  improves as those packs evolve on their own. Buying pays the counter's
  price (`score / 2`, always more than it pays for the same animal) and the
  vroomon arrives **in your herd as well as your Herd Book**, ready to breed
  with.
- **Seed herd** plants a caught specimen straight into the breeding pool.

Nothing here shortcuts breeding: what you buy is a wild animal, you pay over
the odds for it, and it still has to be bred with. Oxide's line in town —
"I move stock up and down this road" — finally has a counter behind it.

### Two more bugs found while building it

- **Seeding a herd never saved.** Pasting a champion DNA and refreshing lost
  it: the run state is its own save and the seed handler never wrote it.
- **Releasing and culling were not counted.** The `release` quest objective
  waited on a tally nothing incremented; both the release button and the
  cull-to-top-ten path now count, so a job can measure them.

## Marrow Orchard: a new area with its own people (2026-09-15) ✅

A new outdoor map hanging off Starter Town's north lane and Route 1's hedge —
an orchard of fence rows, a pond, and wild clover, so it founds **its own
evolving wild pack** the first time you walk the grass (`WILD unmet` until
you do).

Four people live there, each teaching something the game has but never says
out loud:

- **Orchard Keeper Maren** walks you through the **Heritage** page (tap a car
  to trace its line back to the founders) and hands out *A Marrow Cutting* —
  bring her a car that runs 900 on the flat, and she pays in a **Marrow
  scion**, a genome from her own line.
- **Fitter Aubrey** explains what the **inspector** is for: plates for
  structure, wheels joined at their centres, the power path running through
  them.
- **Picker Sprout** races anything that comes up the lane (a training race on
  the usual rider-race path).
- **Beekeeper Hollis** wants the wild thinned off her clover (*Thin The
  Clover* — six genomes, paid in **bee skeps**, an earned-only decor) and
  offers *The Long Pollination*, a walk out to the Drift Perimeter.

New tile: **fence** (posts and two rails, blocking), drawn and exported
through the normal sprite pipeline.

### Two new invariants

- **The map graph is walkable from town.** A test floods the undirected
  transition graph from Starter Town and asserts every area is reachable and
  that no area strands you (every map has at least one exit).
- **Every NPC can be walked to** (added with the ranch split) now covers the
  orchard's four givers automatically.

## Side quests, and the world-save bug they flushed out (2026-09-15) ✅

The world now hands out **jobs**. Five ship today, from three givers:

| Job | Giver | Ask | Pay |
|---|---|---|---|
| The Wrangler's Muster | Wrangler Jess (town) | beat 3 wild vroomon | 120 cr + 3 feed |
| Freight For The Mesa | Wrangler Jess | walk the Highland Mesa | 200 cr |
| Fitters' Errand | Fitter Ollan (town) | 3 pieces in the meadow | 90 cr + a range sign |
| Samples From The Grass | Oxide (route 1) | 4 Herd Book samples | 60 cr + a genome |
| Counting The Road | Oxide | run 5 generations | 140 cr + 4 feed |

`src/renderer/world/side-quests.ts` is pure and unit-tested: a quest is a
declarative objective (`win-wild`, `catch-wild`, `generations`, `decor`,
`visit`, `brands`, `champion-score`, `release`), progress is **derived** from
the world and the run rather than tracked in a dozen places, and accepting one
is a dialogue `setFlag` — the mechanism NPCs already use — so a new job never
needs new dialogue plumbing. Rewards pay out once (recorded in the world's
`tally`, so a save cannot double-pay), are announced with the same banner the
herd uses for a new outlier, and **earned-only decor** (`meadow-sign`) is
filtered out of the ranch shop so the only way to own it is to do the work.

New NPCs: **Wrangler Jess** (market square) and **Oxide** (the road), plus the
world's `tally` — counters for wild races won, maps walked and quests paid —
which ride along in the save.

### The bug this flushed out

Chasing a flaky e2e turned up a **data-loss bug in the world save**. The
debounced save refused to write while `activeNpc || currentEncounter` was set
and — because the debounce had already fired — nothing ever came back for the
change. A wild catch made during the tutorial's praise beat never reached the
file: the HUD showed `1 specimen`, the save showed none, and the loss was
silent. The guard was unnecessary in the first place: `serializeWorldState`
only writes persistent fields, so a queued dialogue is not in the shape at
all. It is gone, with a comment explaining why it must not come back.

## The wild evolves too, with nobody in charge (2026-09-15) ✅

Wild vroomon used to be a random DNA string conjured per step, so once your
own herd was any good, every encounter was a formality and the Herd Book
filled with junk. The wild now **evolves on its own**, the way a ranch herd
does but with nobody steering:

- **Each biome keeps a pack** of 24 vroomon (`src/core/wild.ts`), founded
  deterministically the first time you walk that biome's grass, so the same
  ground always starts with the same animals. Packs live in the save with a
  generation count.
- **The ground is the only selector.** The pack is raced on its own biome's
  terrain — Grassland packs are selected on Grassland, Ice packs on Ice — so
  each biome breeds its own kind of fast.
- **Every meeting turns the pack over a generation.** The fastest half breed,
  four wanderers drift in from elsewhere, and the pack's best are still out
  there (without carrying the champions over, the wild's score *wandered* —
  measured 804, 1143, 1386, then 1153, 1028, 599 — because the pool was
  rebuilt from scratch each generation).
- **You meet a specimen, not the alpha.** The encounter hands you the pack's
  middle animal. Meeting the champion made the wild a wall — and made the
  tutorial's first catch *unwinnable*, since Robby's loaner (~460px) is
  slower than a selected pack's best.

The world HUD carries the biome's pack (`WILD gen 5` / `founder stock` /
`unmet`), so the arms race is visible while you walk rather than only at the
moment of a race.

The race window makes the wild legible: it names the pack's generation, states
what the ground's best can do (`this ground's best runs 479px`), and parks both
machines in their lanes — drawn from the parts their DNA builds — before you
press Race. Esc lets the wild one go, which also breeds its pack on.

Measured on the home paddock: founder stock has a representative at **112px**
and a champion at 479px; after eight generations the representative is at
**858px** and the champion at **1744px**. Robby's loaner (460px) therefore
wins the first catch comfortably and is out-classed by generation three —
which is the point: the wild improves at roughly half the rate of a tended
herd, so *breeding* is how you stay ahead, and a catch is only worth making
when you can beat the ground it came off.

## Indoors and outdoors are separate places (2026-09-15) ✅

The ranch used to be one map with a house drawn in the top-left corner of the
paddock. It is now **two spaces with a door between them**:

- **`home_ranch` — The Shoddy Ranch House.** Walls, wooden floor, bed,
  counters. Robby is in the kitchen.
- **`ranch_yard` — The Ranch Yard.** The tall-grass paddock, the porch, the
  Carrier Bench, and the garden gate to town.

The story crosses that boundary: the reveal beat in the kitchen ends with
Robby swinging the pasture door wide, and a new `goto:<map>:<x>:<y>:<node>`
completion walks you into the yard and picks the lesson back up on the far
side (a dialogue chain cannot span two maps). The town's doorstep now opens
into the yard rather than into the house.

## Hunting is your choice, and catching means racing (2026-09-15) ✅

- **A hunt toggle** in the world HUD (`SEEKING ON 🔍` / `OFF`, or press **H**)
  decides whether the tall grass is dangerous. With it off you can cross your
  own paddock without a race every three steps. Robby puts you on the hunt
  when he hands over the loaner (otherwise the lesson's grass would never
  shake and the tutorial could not continue), and if you switch it off during
  that lesson the quest line says so instead of leaving you pressing Z at
  nothing.
- **Wild vroomon are never free.** Walking the grass opens a **race**: your
  best car (Record Barn champion, else the strongest in the herd) against the
  wild one, on the same terrain, both drawn lane-by-lane as the parts they are
  made of. Win and its genome joins your Herd Book; lose and it gets away, and
  nothing is recorded. The controller no longer records a wild genome at all —
  the race owns that verdict.
- **Robby lends a starter** ("she's slow but she runs") during the yard
  lesson, so the first catch is winnable and everything after it has to be
  *bred* faster than the one before. That is the point of the change: the wild
  can hand you a floor, not a ceiling.

- **New invariant: every NPC can be walked to.** A test floods each map
  from the tiles its entrances land on and asserts every positioned NPC has a
  reachable neighbour — the map split moved a dozen NPCs between two spaces,
  and a walled-off Robby would have been an unrecoverable tutorial.

- **The house is a room, not a corner of a field.** Interior maps render
  against a dark room tone instead of the deep forest (the house used to
  float in woodland), the floor has a bed, counters and a table, and a
  **save made before the split is relocated**: a position out in the old
  paddock belongs to the yard now, so loading it puts you on the porch
  instead of outside the new house's bounds (`safeSpawn`).

Bugs found while wiring this up, all fixed:

- **The herd was not restored on reload.** The world persisted (rancher, map,
  brands, Herd Book) but the animals did not — a refresh lost your herd, and
  Robby's loaner with it. The boot now restores the saved run silently, keeps
  the welcome status, ignores partial saves (a missing `config` used to throw
  during boot), and lands on the title screen rather than the bench.
- **The ranch quest never advanced.** `quest.ts` waited on a `tut-revealed`
  flag that nothing ever set, and the tall grass set `tut-catch` while the
  quest and renderer both read `tut-caught` — so the objective line sat on
  "Robby's in the kitchen" forever. One flag name each now, set at the beats
  that earn them, with a test walking the whole tutorial.
- **Both gym doors dropped you inside a tree** (the exits pointed at the
  route's border tile). A new test checks that every transition in every map
  lands on something you can stand on.
- The `goto` beat dropped its `setFlag`, the HUD's map chip went stale on a
  transition, the toggle repainted the state but not the chip, and closing the
  race didn't repaint the world underneath (a won race queued Robby's praise
  beat that never appeared).
- The Barn button's tutorial pulse was keyed to the house alone, so it never
  pulsed during the praise beat — which happens out in the yard now.

## Breeding was not actually working (2026-09-15) ✅

Found by measuring the loop the game is built on, and it was badly broken.

**Symptom.** Over 25 generations of 60 cars the herd's best score was
**1834, every single generation** — and 25 *fresh random populations* reached
**2363**. The simulator was worse than rolling dice, and "finding the right
combination" was impossible because nothing accumulated.

Three separate causes, each measured rather than guessed:

1. **Mutation was not local.** The decoder mixes a part's parameters from a
   window of neighbouring DNA positions, and the window was wide enough that
   a one-character mutation changed 9-13 of 13 parameters: children were
   unrelated to their parents, so selection had nothing to climb. Narrowing
   it (4 → 1) is the difference between breeding and rolling dice.
2. **Half the genome was inert.** A module read positions `index ± window`
   with a stride of 1, but the module count is decoded from the DNA and stays
   small (2-6) — so on a 12- or 20-character genome, characters past the
   early slots were **never read**. Mutating them changed nothing and a
   crossover cut in that region produced an exact clone of a parent. The
   stride now spans the whole genome, and a test asserts that flipping *any*
   character changes the car.
3. **A car's score depended on its slot in the race.** The population was
   scored by racing all 45 cars in ONE shared world, spawning car *i* at
   `220 + i*150` — so the same DNA parked next to different obstacles scored
   differently from one generation to the next. That noise went straight into
   selection, which is why the herd's best oscillated instead of climbing and
   a champion could appear to regress without its DNA changing. Every car is
   now raced alone, at the same spot.

**Measured after the fixes** (`tests/evolution.test.ts`, which exists to keep
it true): a herd climbs `757 → 2570` over 18 generations, and breeding beats
an equal-budget random control **2195 vs 1544** on average across seeds. The
elite is preserved every generation (verified by tracking champion ids).

Also fixed on the way: the decode clamps for plate width/height, wheel radius
and friction now sit inside the bounds the Godot design declares (friction
could previously reach 2.4 and radius 42, past the design's 2.0 and 40), and
the auto-run's plateau tolerance went from 6 to 15 dry generations — one
measured seed improved nothing for 8 generations and then found a 25% better
car, which the old limit gave up before reaching.

## The vroomon inspector (2026-09-15) ✅

A window for one vroomon, opened with 🔍 Inspect from the herd book, the
paddock, or a line in the heritage tree (Esc closes it):

- **The car, drawn large** — plates and wheels as the simulation builds them,
  so you can see the chain rather than guess at it.
- **Stats**: structure, power path, driven wheels, power and torque at the
  wheels, mass, what the frame costs (tilt, dragging hull), the share of the
  drive that reaches the ground, top speed, length.
- **Parts, slot by slot**: every index with its structure (plate 41×29 @ +6°,
  wheel r17), its powertrain module (cylinder/driveshaft/gearset) and the
  power that wheel actually receives.
- **Five tracks** — Flat, Grassland, Hills, Rocky, Ice — each runs the real
  simulation for a three-second race and reports `flies / competitive /
  crawls / sits there / runs backwards` with the distance and top speed. The
  run then **plays back** (▶ Run / ⏸ Pause with a scrubber and a clock), so
  you watch it move instead of reading a number.

Opened from a herd-bench selection, a herd-book row, the paddock draft, or a
line in the heritage tree. It draws above the Pocket Ranch hub it is opened
from — it rendered *behind* the hub at first, which looked like the button
doing nothing.

The maths is shared, not duplicated: `src/shared/frame.ts` holds the frame
geometry and its costs, the simulation builds from it, and the inspector
reads from it — so the window cannot describe a different car than the one
that runs.

## Parts meet: no daylight in the frame (2026-09-15) ✅

Two bugs made a vroomon look like a row of loose tiles rather than one welded
frame:

- The chain **spaced parts by their tilt-inflated bounding boxes**, and the
  drawn plate was narrower than that box, so a gap of up to 35px of
  background showed between plates at their centre line. Consecutive parts
  now **overlap by design** (`CHAIN_OVERLAP`), because parts that merely
  touch leave a wedge of daylight between tilted plates.
- The snapshot reported a plate's size as its **bounding box**, so a tilted
  plate drew wider than it is. Plates now remember their true rectangle when
  they are built (measuring the vertices does not work: a chamfered plate has
  a dozen of them).

Verified by reading the pixels: no background remains between the parts of a
vroomon's body.

## The vroomon body: one rigid frame, driven at the wheels (2026-09-15) ✅

Follow-up to the two-path port below. Pinning separate wheel bodies to a
chassis with zero-length joints turned out to be the wrong shape for Matter:
holding a car together with joints every frame meant the solver resolved
small interpenetrations by throwing cars off the ground — measure just how
badly, and 42% of bodies went airborne, one of them 6,600px up, some sank
through the floor, and a few hung in the air instead of landing.

The vehicle is now **one rigid body**: every plate and every wheel is a part
of it, so the chain is literally a chain and nothing can come apart. Drive is
a force applied *at each wheel the power path reaches*, capped by the speed
that wheel's power can hold (more engines = faster; a heavy frame = slower;
a force applied off-centre pitches the car the way real drive does). Wheels
are drawn rolling by distance travelled, since a rigid part doesn't spin.

Fixes along the way, each found by measurement rather than by eye:
- **`Body.create({ parts })` copies the parent's properties onto the parts**,
  so per-part friction is impossible in one body — and Matter's resolver
  reads `parentA.friction` anyway, never the part's. Grippy wheels and draggy
  plates at once can't be expressed in Matter, so the frame's cost is
  modelled explicitly instead (see below).
- **Matter's velocities are per step, not per second.** The drive's terminal
  speed and the speed clamp were both comparing the wrong units, so neither
  limited anything.
- **Obstacles used to start at x=600** while a 12-module car is ~1000px long,
  so long cars spawned *inside* terrain and were fired off the track. The
  first obstacle now sits at 1600 with 500px spacing, and the floor is 400px
  thick so nobody tunnels through it.
- A speed clamp plus a rollback of any step that moves a body further than a
  frame at top speed could, so a bad frame can never become a rocket.

**What the frame costs** (`SIM_TUNING` in `src/simulation/matter-simulation.ts`,
one object so tuning is one edit and can be measured): drive is scaled by
`drivenWheels / wheels` divided by the cost of plates out of line and of a
hull riding below its own wheels. So the design's rules are the physics:
an arch of plates on driven wheels runs; a folded run of plates drags; a
frame with no cylinder before a wheel doesn't move at all.

Measured over random 12-module DNA on Flat, 3-second races (the race window):
**23% are competitive** (>300px), 68% creep somewhere, none launch, and the
best does ~1,200px. Good cars still reach ~4,300px in a 30-second run, so the
circuit's score scale is unchanged.

## The vroomon body: two-path chains (2026-09-14) ✅

Ported the original design out of the legacy Python prototype
(`src/vroomon/car/`), where it had been lost in the rewrite. A vroomon is a
**chain of two parallel paths**:

- **Structure** (`frame`): rectangles and wheels in one chain. The
  rectangles are plates on ONE rigid chassis, joined edge-to-edge along the
  line and each keeping its own tilt — so a run of plates can arch (good
  breakover) or fold at a bad angle and never roll. Wheels are their own
  bodies **pinned by a zero-length joint at their centre**. `wheel wheel
  wheel` has no structure and, now, no drive either.
- **Power** (`powertrain`, same length, paired index by index): cylinders
  make power, drive shafts bleed efficiency, gear sets hand a share to the
  wheel in their own slot and pass the rest on. `wheelDriveForIndex` is a
  faithful port of the prototype's `calculate_wheel_power`, so **order
  matters**: a wheel with no cylinder upstream is dead weight, and most
  combinations simply don't work — as intended.

Fixed while porting (each one had made every car look floppy or crawl):
- every rectangle used to be its own body joined by soft springs (the
  floppiness); the chassis is now one compound body;
- wheels used to hang 50px below on a spring; they're pinned at their
  centres and the hull's real ground clearance is computed from the plate
  tilts (tilted plates drop their corners, so an arch rides high);
- cars spawned at a hardcoded y=220 with the ground at 400 — every race was
  spent free-falling; they now spawn resting on the terrain;
- the drive sign was inverted for Matter's y-DOWN world (the port of
  pymunk's y-up `-power/size` drove every car backwards);
- wheel velocity was teleported per frame, yanking the rigid chassis into
  a 17,000-radian spin; it's a torque-limited motor chase now.

Measured on Flat (30 simulated seconds): well-formed cars travel
**900–2000px** (best two-wheeler found: 1898px, plates-then-wheels with
cylinders early); ~20% of random 12-char DNA moves meaningfully at all, so
there's a real signal to select on. `tests/power-path.test.ts` (7 tests)
pins the power semantics; the DNA regression fixture and the two
drive-integrity tests now use cars that genuinely work.

## Outstanding gameplay/UI issues (identified, not yet fixed — design work)

From the vision-model critique + probes, ordered by impact:

- **Equipment/cosmetic depth**: car bodies are still flat color blocks without
  shading or per-chassis variation; cross-entity z-order means a dense pileup
  can still look like a web of constraint lines.
- **Hall of Fame card blank** ("Top:"/"Saved:" empty) and overlapped by the
  error-logger ring (`.error-toggle` bottom-right). Error badge shows "0" and
  is permanent player chrome — hide it until `data-has-errors="true"`.
- **Batch progress pill** is positioned at `top: 0.5rem` behind the fixed
  36px top bar (blurred smudge); move below the bar.
- **Vehicle focus strip buttons are unstyled** (`.active`/`.ghost` have no CSS
  in game.html) and overlap the config panel.
- **Status line** at 8px, `rgba(255,244,209,0.75)` on the sky (~1.2:1 contrast),
  baseline clipped; dev copy "Ready to begin the Electron rewrite preview."
  ships in the status line (`state.ts` createRendererState).
- **Terrain select + gen pill shown in world mode** (meaningless there).
- **Aesthetic**: obstacles are flat gray slabs; cars are translucent blobs with
  no wheel shading; three Google Fonts loaded from CDN (offline risk in the
  Electron build); ~60-90% empty sky in most modes.

Candidate A/B tests for later (use `ab_test_visuals`): menu screen design,
label strategy (leader-only vs collision-avoidance), HOF surfacing in web UI.

## Recipes for future sessions

### Run nested pi (vision sub-agent)

Installed `pi` (v0.85.1). The big gotchas:

- `pi --print` text mode emits **nothing** when the autopilot-complete
  extension is active (the run ends with a `complete` tool call, not a reply).
  **Use `--no-extensions`** for sub-agents that must answer.
- `--mode json` (rich session stream, works even with extensions) is the
  fallback; parse `message_update` events for assistant text.
- Usable vision models on provider `opencode-go`:
  - `opencode-go/deepseek-v4-flash-vision-exp` — worked; 6 downscaled 1280px
    images took ~5 min.
  - `opencode-go/muse-spark-1.3-contributor` — configured but returns 403
    DataPolicyError (requires opt-in at opencode.ai).
  - `opencode-go/qwen3.6-plus`, `glm-5.1` — catalog entries reachable but
    returned nothing in testing.
- 14 full-size (2160x1350) images blew the timeout; downscale with ImageMagick
  (`convert shot.png -resize 1280x shot-small.png`) and cap at ~6 images.

Working invocation (from `megarepo`):

```bash
timeout 560 pi --print --no-session --no-extensions \
  --model opencode-go/deepseek-v4-flash-vision-exp \
  --append-system-prompt "You are a meticulous UI critic..." \
  "Review these captions." @/tmp/vroomon-captures/01-menu-small.png ... \
  > /tmp/vision-critique.md 2>/tmp/vision-critique.err
```

### Overworld canvas verification (blank-screen regression)

```js
const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
// painted pixels = count of alpha > 0; was 0 before the fix, 640*480 after.
```

### OCR-based screen reading

`tesseract <shot.png> stdout --psm 11` — sparse text; good for confirming
which readouts/buttons are actually on screen (e.g., it proved the menu screen
showed GENERATE/REPLAY buttons and that the world showed only the status line).

### Overlay visibility probe

For each mode, check the overlay wrappers: `hidden` attribute, computed
`display`, and `getBoundingClientRect().width>0`. Any `display:flex` element
with `hidden=true` but non-zero rect = the hidden-attribute bug.

## Verified baseline (post-fix)

- `npm run build` clean; `npm test` 135/135; `npm run test:e2e` 10/10
  (`VROOMON_BROWSER_EXECUTABLE=/run/current-system/sw/bin/google-chrome-stable`).
- Menu/evolution/test-drive screens are now per-mode clean; overworld paints;
  keyboard mode switching works everywhere.