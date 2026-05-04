# Code Reviewdle MVP

## Concept

Code Reviewdle is a daily puzzle game where the player reviews a larger code snippet that contains exactly **one clear flaw**.

The player must identify:

1. **The flawed line**
2. **The issue type**

The experience should feel like Wordle:

- one puzzle per day
- a limited number of guesses
- progressively stronger hints after incorrect guesses
- simple shareable results

## Core Player Loop

1. Open today’s puzzle.
2. Read a realistically sized code snippet.
3. Guess the buggy line.
4. Guess the issue category.
5. Receive feedback:
   - whether the line is correct
   - whether the issue type is correct
   - whether either guess is close
6. After incorrect guesses, unlock a hint.
7. Solve the puzzle or run out of guesses.
8. See explanation and optionally share results.

## MVP Goals

The MVP should prove three things:

1. The puzzle is fun and understandable.
2. The hint system makes the game feel fair.
3. A lightweight content pipeline can produce daily puzzles consistently.

## Non-Goals for MVP

Avoid these at first:

- multiple flaws in one snippet
- multiplayer features
- user-submitted puzzles
- AI-generated puzzles in production without review
- advanced code execution or sandboxing
- requiring executable sandboxing for every language from day one
- complex scoring systems
- accounts, streak sync, or leaderboards

## Recommended MVP Scope

### Puzzle format

Each puzzle should include:

- a larger snippet, ideally **25 to 60 lines**
- exactly **one intended flaw**
- one canonical primary issue type
- a short human-written explanation
- 2 to 4 hints

### Recommended language strategy

Do **not** restrict the game to a single language.

The core fantasy is reviewing noteworthy bugs from real software history, so the MVP should support **multiple languages** as long as each puzzle remains readable and self-contained.

Recommended launch mix:

- Python
- JavaScript / TypeScript
- C / C++
- Java / C#
- other notable languages when a bug is famous and the snippet is still teachable

Design rule:

- choose the language that best fits the bug story
- keep snippets readable enough that a careful generalist can reason about them
- provide a short context note when domain-specific syntax might otherwise be confusing

### Recommended issue categories

Keep the taxonomy small for MVP. For example:

- Bounds / off-by-one
- Null / missing-value handling
- Wrong conditional logic
- Mutation / shared state
- Async / timing misuse
- Race condition
- Security check bypass
- Numeric overflow / underflow
- Incorrect API usage
- Resource handling failure
- Reentrancy

The issue list should be short enough that players can learn it quickly.

## Guessing Model

Each guess has two parts:

- **Line number**
- **Issue type**

### Feedback rules

For the line guess:

- **Correct**: exact flawed line
- **Near**: within 1 line of the flawed line
- **Wrong**: otherwise

For the issue type guess:

- **Correct**: exact category match
- **Related**: optional future feature if categories have families
- **Wrong**: otherwise

For MVP, exact issue-type matching is enough.

## Hint System

Hints are the main fairness mechanism.

Recommended progression:

- **Hint 1:** broad region or direction
  - example: “The problem is in the loop, not the return.”
- **Hint 2:** conceptual clue
  - example: “Think about what happens on the final iteration.”
- **Hint 3:** stronger structural clue
  - example: “The bug appears when the list has length 0 or 1.”
- **Hint 4:** near-spoiler
  - example: “Inspect line 8 and the range boundary.”

Recommended unlock rule:

- unlock one new hint after each incorrect guess
- cap at 3 or 4 hints

## Puzzle Authoring Rules

To keep puzzles fair, every puzzle should satisfy all of the following:

- exactly one intended flaw
- exactly one intended answer line
- exactly one primary issue category
- snippet is understandable without large external context, even when drawn from a famous bug
- names are readable and realistic
- bug is interesting but not trick-based
- explanation can clearly justify why the flaw matters
- hints escalate cleanly from subtle to explicit

## Content Model

A single puzzle record could look like this:

```json
{
  "id": "2026-05-04",
  "title": "TLS Certificate Validation",
  "language": "c",
  "source_note": "Inspired by Apple's goto fail bug",
  "code": [
    "int validate_server_key(ServerHello *handshake) {",
    "    int status = 0;",
    "    HashContext hash_context;",
    "    ... at least 25 lines total ...",
    "    goto fail;",
    "    status = finish_hash(&hash_context, &expected_hash);",
    "}"
  ],
  "answer_line": 18,
  "issue_type": "Security check bypass",
  "explanation": "A duplicated control-flow jump exits verification early and skips a required cryptographic check.",
  "hints": [
    "The flaw is in the verification flow, not the setup code.",
    "A control-flow statement runs even when the previous operation succeeded.",
    "Look for a line that exits too early and skips the final check."
  ]
}
```

For implementation, JSON or YAML would both work. JSON is fine for MVP.

## Daily Puzzle Strategy

For MVP, prefer a **pre-authored puzzle bank** over dynamic generation.

Recommended approach:

- manually create 30 to 60 puzzles, with several drawn from famous bug families or specific historical incidents
- assign each one a date
- ship them as static content

Why:

- much easier to guarantee fairness
- avoids low-quality generated bugs
- makes the explanation and hints much stronger

Later, an internal authoring tool could help draft and validate puzzles.

## UX Requirements

The MVP UI should support:

- viewing formatted code with line numbers
- selecting a line number easily, even in a 25+ line snippet
- selecting an issue type from a short list
- understanding the language and bug context at a glance
- receiving instant feedback after each guess
- showing unlocked hints progressively
- showing guesses history
- revealing the explanation at the end
- copying a spoiler-free share result

### Nice default interaction

- click a line to select it
- choose issue type from buttons or dropdown
- submit guess
- results show with color and text labels

## Game Rules Recommendation

A simple default rule set:

- **6 total guesses**
- **1 puzzle per day**
- **1 new hint per incorrect guess**
- puzzle auto-locks to local date or server date

For MVP, local-date puzzle selection is acceptable if this is mostly a prototype.
If cheating matters later, move puzzle selection to the server.

## Technical Recommendation

Because this is a lightweight daily puzzle, the simplest good MVP is:

- small web app
- static or near-static puzzle content
- minimal backend, or no backend at first

### Suggested architecture options

#### Option A: Static frontend first

- HTML/CSS/JS or TypeScript frontend
- puzzle content bundled as JSON
- localStorage for in-progress state and streaks

Pros:

- fastest to build
- easy to host
- minimal moving parts

Cons:

- easy to inspect future puzzles
- weaker control over daily release

#### Option B: Thin Python backend

- Flask app
- serves only today’s puzzle
- stores puzzle bank locally
- tracks daily access and optional analytics later

Pros:

- better control over puzzle release
- easier future growth

Cons:

- more implementation work

### Recommendation

Start with **Option A if speed matters most**.
Start with **Option B if daily integrity matters from day one**.

## Accessibility and Clarity

MVP should still aim for:

- high contrast feedback colors
- text labels, not color alone
- keyboard-friendly controls
- readable monospace code block
- hints and feedback that are understandable without insider jargon

## Risks

### 1. Ambiguous puzzles

Risk:
Players think multiple lines are flawed.

Mitigation:
Human-review every puzzle against a fairness checklist.

### 2. Issue taxonomy confusion

Risk:
Players do not know the difference between categories.

Mitigation:
Keep the category list short and define categories clearly in UI.

### 3. Hint quality inconsistency

Risk:
Hints are either useless or spoilers.

Mitigation:
Author hints in a fixed escalation pattern.

### 4. Content pipeline too weak

Risk:
It becomes hard to create enough good daily puzzles.

Mitigation:
Ship with a finite curated bank and build author tooling later.

## MVP Success Criteria

The MVP is successful if:

- players can understand the game without a tutorial wall
- most puzzles feel fair
- hints rescue players who are stuck
- explanations feel satisfying after reveal
- authoring a new puzzle is straightforward

## Suggested Phase Plan

### Phase 1: Design the game contract

Define:

- issue taxonomy
- puzzle schema
- guess feedback rules
- hint progression rules
- fairness checklist

### Phase 2: Build a vertical slice

Build one playable puzzle with:

- code viewer
- line selection
- issue-type selection
- guesses and hints
- win/loss reveal state

### Phase 3: Author a starter pack

Create 10 to 20 curated puzzles to validate:

- difficulty spread
- issue taxonomy clarity
- explanation quality
- hint usefulness

### Phase 4: Add daily mode

Add:

- date-based puzzle selection
- local persistence
- share result output
- basic streak tracking

## Open Decisions

Before implementation, decide:

1. Should the game live as a new project under `active/games/`?
2. Is MVP frontend-only, or do you want a thin Flask backend?
3. Should issue types be broad and beginner-friendly, or more code-review-professional?
4. Do you want pure daily mode only, or also a practice archive?
5. How much context should each multi-language puzzle include so it stays approachable without dumbing it down?

## Recommended Final MVP Definition

If we want the leanest strong version, the MVP is:

- one daily multi-language code-review puzzle
- exactly one flawed line and one issue type
- six guesses max
- one hint unlocked after each wrong guess
- short explanation on reveal
- 30+ pre-authored puzzles in a static content bank
- local progress and shareable results

That is small enough to build, test, and tune, while still being recognizable as a complete game.