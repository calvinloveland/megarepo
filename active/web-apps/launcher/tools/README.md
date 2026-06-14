# tools/

This directory holds the launcher's tooling: the demo-video generator,
shared scene infrastructure, and a headless smoke test for the
dashboard.

## Architecture

```
constants.py      ← colors, fonts, dimensions
animation.py      ← easings, lerps, frame progress helpers
scene_lib.py      ← chrome (header/footer), panels, easings
demo_scenes.py    ← one hand-crafted scene per project (15)
generate_demos.py ← reads apps.yaml, dispatches to a scene, encodes MP4
```

Every project registered in `apps.yaml` has a dedicated scene function
in `demo_scenes.py` keyed by app id. The fallback `scene_default`
renders the original title-card template.

Each scene is a 16-second composition that *shows* what the project
does, instead of just describing it:

| App | Scene concept |
|-----|---------------|
| **momos** | A "today" dashboard with 4 widget cards (calendar, inbox, pantry, reminders) |
| **parambulator** | A 5×6 classroom grid with student names and a live fitness score |
| **sub-day-generator** | A printed lesson plan paper that fills itself in section-by-section |
| **vernissage** | A Mondrian composition in a gold museum frame with a metadata plaque |
| **holdem-together** | A green felt poker table with 2 hole cards, 3 community, pot counter, "your turn" |
| **code-reviewdle** | A code editor with a `debounce` function, a glowing BUG line, and 6 guess slots |
| **conway-war** | A 30×14 cellular automaton with red/blue armies, a generation counter, territory bar |
| **wizard-fight** | Two wizard character cards with HP bars and a spell impact in the middle |
| **wizard-fight-ui** | Same duel from the React frontend's perspective |
| **trading-cards** | A fan of 5 TCG cards with attack/health stats drawn from a shrinking deck |
| **powder-play** | Three glass vials of colored powder mixing into a "Storm Salt" beaker |
| **hivemind** | A 5-node network of LLMs with a request packet flowing through them |
| **hivemind-frontend** | A chat interface with the user message and a streaming LLM haiku |
| **operationalize** | A 3-column kanban board with cards (To Do / In Progress / Done) and a card mid-flight |
| **recursive-thermofluid-sandbox** | A top-down simulation with a rotating wheel, orbital particles, and a temperature gradient |

## Run

From the launcher directory:

```bash
nix-shell -p python3Packages.pillow python3Packages.pyyaml ffmpeg \
    --run "python3 tools/generate_demos.py"
```

Useful flags:

```bash
# Render a single demo
python3 tools/generate_demos.py --only momos

# Render a subset
python3 tools/generate_demos.py --only momos,parambulator,vernissage

# Custom output directory
python3 tools/generate_demos.py --out /tmp/demos

# Keep intermediate PNG frames (for debugging)
python3 tools/generate_demos.py --keep-frames
```

## Output

Videos land in `demos/<app-id>.mp4` (e.g. `demos/momos.mp4`). They are
served by the launcher at `/demos/<app-id>.mp4` and indexed by
`/api/demos`.

## Re-rendering posters

The Demos tab in the launcher uses a JPEG poster (a representative
frame from each scene) as the thumbnail.

```bash
cd active/web-apps/launcher
for mp4 in demos/*.mp4; do
  id=$(basename "$mp4" .mp4)
  ffmpeg -i "$mp4" -ss 5 -vframes 1 -q:v 5 -y "static/demos/${id}.jpg"
done
```

## Adding a new scene

To add a custom scene for a new project, add a function to
`demo_scenes.py`:

```python
def scene_my_project(app, img, t):
    # Draw onto img at time t (0..16 seconds).
    # Standard chrome (header, footer) is added automatically
    # by render_frame() in generate_demos.py.
    ...
```

Then register it:

```python
SCENE_REGISTRY["my-project"] = scene_my_project
```

Re-run the generator. The new scene will be picked up automatically
and exposed via the **Demos** tab and the **▶ DEMO** button.

## Smoke test

`smoke_test.js` runs a headless Chromium against the dashboard and
exercises every tab plus the demo modal. It catches regressions like
the duplicate `const SCENES` SyntaxError that left the page inert for
days.

```bash
# Local dev (launcher on http://localhost:3001)
npm install --prefix tools
nix-shell -p chromium --run "node tools/smoke_test.js"

# Production
URL=https://launcher.shsw.dev node tools/smoke_test.js
```

Exits 0 on success, 1 on any failed check, 2 on a fatal error.
