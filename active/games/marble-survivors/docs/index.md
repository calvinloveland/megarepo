# Blood Marble — Gyro Survivors (Expanded)

Game project for the megarepo — a mobile-first gyroscope-controlled marble roguelite in the vampire-survivors style.

## Tech

- **Canvas 2D** rendering with particle effects, screen shake, 3D sphere rendering
- **Momentum physics** (Super Monkey Ball–style): the marble accelerates and coasts
- **DeviceOrientation API** for gyroscope input (iOS permission flow supported)
- **Mouse/touch/keyboard fallback** for desktop play — gyro auto-falls-back to touch when no events fire
- **Gates as the XP source**: roll through glowing gates to level up (killing enemies gives score only)
- **Web Audio API** for SFX (hit, XP, level-up, explosion, heal, game over)
- **No build step** — pure HTML/CSS/JS, served by a minimal Node static server

## Content

- **12 enemy types** with unique behaviors (ghost phase, witch ranged attacks, werewolf enrage, hellhound fire trails, necromancer summoning, golem splitting, boss shockwaves)
- **18 upgrades** across 5 categories: stats (5), auras (2), defense (2), projectiles (5), economy (4)
- **Wave system** with scaling difficulty, bosses every 5 waves, and wave-clear bonuses
- **DPR-aware** rendering for crisp display on Retina/HiDPI screens

## Game Systems

### Enemy Behaviors
- **Phase (Ghost)**: Periodically teleports and becomes semi-intangible
- **Ranged (Witch)**: Maintains distance, fires homing magic bolts
- **Berserk (Werewolf)**: Enrages at 50% HP with doubled speed and damage
- **Fire Trail (Hellhound)**: Leaves damaging fire patches on the ground
- **Summon (Necromancer)**: Spawns bats periodically
- **Split (Golem)**: Splits into two smaller golems on death
- **Boss**: Fires expanding rings of projectiles

### Projectile Modifiers
- **Piercing**: Passes through enemies with damage falloff
- **Homing**: Curves toward nearest enemy for better tracking
- **Explosive**: Area damage on impact with screen shake
- **Chain**: Bounces to nearest nearby enemy

### Defensive Systems
- **Shield**: Stackable charges that absorb all damage from one hit each
- **Thorns**: Percentage of contact damage reflected
- **Freeze Aura**: Slows all enemies within radius
- **Fire Aura**: Continuous damage-over-time within radius

## Project Structure

```
active/games/marble-survivors/
├── index.html      # Entry point: canvas, overlays, controls bar
├── style.css       # Mobile-first dark theme, touch-optimized
├── game.js         # ~1700 lines — all game logic
├── server.mjs      # Minimal Node.js static server
├── package.json    # Project metadata
├── README.md       # Full documentation
├── AGENTS.md       # Project-specific agent instructions
└── docs/
    └── index.md    # Web docs
```

## Running

```bash
npm start
# or
node server.mjs
```

Opens on port 3003 by default. Set `PORT` env to change.

## Launcher Registration

```yaml
- id: marble-survivors
  name: Blood Marble
  description: Gyro-controlled vampire-survivors roguelite — tilt your phone to roll a marble through hordes of enemies
  icon: 🔮
  subdomain: marble
  path: ../../games/marble-survivors
  type: node
  port: 3003
  start_cmd: "node server.mjs 2>&1"
  env:
    PORT: "3003"
```
