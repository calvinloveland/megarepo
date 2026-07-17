# Blood Marble — Gyro Survivors

🔮 **A mobile vampire-survivors roguelite where you control a marble by tilting your phone.**

Survive waves of 12 enemy types across escalating waves. Tilt your device to
roll the marble — with **Super Monkey Ball–style momentum physics** (the ball
accelerates and coasts, so it carries weight). Auto-attack nearby enemies, and
**roll through glowing gates to gain XP**, level up, and choose from **18 unique
upgrades**. How long can you last?

## Play

```
npm start
```

Then open http://localhost:3003 in a browser.

## Tests

```
npm test          # run the Playwright suite (auto-starts the server)
```

77 tests across 8 files cover load/boot, waves, combat, XP/leveling,
controls/gyro, physics & gates, and rendering/UI. On NixOS the config points at
the Nix-managed Chromium; override with `CHROMIUM_PATH` env if needed.

On mobile, use the built-in gyroscope — just tilt to roll.
On desktop, use the mouse, touchpad, or WASD keys.

## Controls

| Input | Action |
|-------|--------|
| **Gyroscope** (mobile) | Tilt to roll the marble |
| **Touch** (mobile fallback) | Drag to guide the marble — works automatically when gyro events aren't firing |
| **Mouse** (desktop) | Move cursor to guide the marble |
| **WASD / Arrow keys** (desktop) | Keyboard movement |
| **P or Space** | Pause / resume |
| **Restart button** | Restart after game over |
| **Gyro / Mouse toggle** | Switch between control schemes |

**Gyro notes:** On Android, `DeviceOrientationEvent` only fires over HTTPS
or `localhost`. If you access via a LAN IP (e.g. `http://192.168.x.x:3003`)
the browser silently blocks gyro — the game automatically falls back to
touch so you're never stuck. The HUD shows the live status:
`🎯 Gyro (live)`, `🎯 Gyro (idle)`, `🎯 Gyro (waiting…)`, or `🖱️ Touch`.
A 12° deadzone means a flat phone won't drift. On iOS 13+, tap the
"Enable Gyro" button to grant motion permission.

## Enemies (12 types)

| Enemy | Behavior | Unlocks Wave |
|-------|----------|:---:|
| 🦇 Bat | Fast, low HP, swarms | 1 |
| 🧟 Zombie | Slow, tanky | 2 |
| 💀 Skeleton | Medium stats | 3 |
| 👻 Ghost | Phases through attacks, teleports | 4 |
| 🧛 Vampire | Fast, high HP, large | 5 |
| 🧙 Witch | Keeps distance, fires magic bolts | 6 |
| 🐺 Werewolf | Enrages at 50% HP (2x speed, 1.5x damage) | 7 |
| 🔥 Hellhound | Fast, leaves damaging fire trails | 8 |
| 💜 Necromancer | Summons bats when threatened | 9 |
| 🪨 Blood Golem | Splits into 2 smaller golems on death | 10 |
| 👑 Elite | Tough, high damage | 10 |
| 👹 Blood Lord | Boss every 5 waves, shoots ring projectiles | 5 |

## Upgrades (18 total)

### Original 9
| Upgrade | Effect | Max Level |
|---------|--------|:---------:|
| 🔥 Move Speed | +15% movement speed | 10 |
| ❤️ Max HP | +20 max HP | 10 |
| ⚔️ Damage | +25% projectile damage | 10 |
| 🏹 Attack Speed | +20% attack speed | 10 |
| 🎯 Range | +20% attack range | 10 |
| 💚 HP Regen | +0.5 HP/sec | 10 |
| 🌀 Multi-shot | +1 projectile per shot | 5 |
| 🧲 Gate Reach | +30% gate capture radius | 5 |
| 💎 Gate Value | +25% XP per gate | 5 |

### New 9
| Upgrade | Effect | Max Level |
|---------|--------|:---------:|
| 🛡️ Shield | Block 1 hit per charge (8s recharge) | 5 |
| ❄️ Freeze Aura | Slow enemies 20% within range | 5 |
| 🔥 Fire Aura | Burn nearby enemies for DPS | 5 |
| ⚡ Piercing | Projectiles pierce +1 enemy | 3 |
| 🔄 Homing | Projectiles curve toward enemies | 3 |
| 💥 Explosive | Projectiles explode for area damage | 3 |
| 🧛 Vampiric | Heal 1 HP per enemy killed | 5 |
| ⚡ Chain | Projectiles chain to nearby enemies | 3 |
| 🗡️ Thorns | Reflect 15% contact damage | 5 |

## How to Progress

Killing enemies grants **score** but **no XP**. You level up by **rolling
through glowing gates** scattered around the world. Gates respawn elsewhere
after you pass through them, and their XP value scales with the current wave.
Gate color indicates value: emerald (low) → gold → violet (high). The **Gate
Reach** upgrade widens your capture radius; **Gate Value** multiplies the XP
per gate.

The marble uses **momentum physics** (à la Super Monkey Ball): it accelerates
toward your input and coasts with friction when you let go, so plan your line
through the gates — the ball keeps rolling.

## Special Mechanics

- **Shield**: Absorbs contact damage entirely. Charges recharge every 8 seconds.
- **Freeze Aura**: Slows all enemies within attack range, shown as a blue ring.
- **Fire Aura**: Continuously burns enemies within range, shown as an orange ring.
- **Piercing**: Projectiles pass through enemies, dealing reduced damage each time.
- **Homing**: Projectiles curve to track the nearest enemy.
- **Explosive**: Projectiles create an area-of-effect explosion on impact.
- **Chain**: Hitting an enemy bounces the projectile to another nearby enemy.
- **Vampiric**: Each kill restores HP.
- **Thorns**: A portion of contact damage is reflected back to the attacker.

## Development

- Pure HTML5 Canvas + Vanilla JS (~1700 lines) — no frameworks, no build step.
- `server.mjs` — minimal Node.js static file server.
- `game.js` — all game logic organized by system.
- `index.html` — entry point with canvas, gyro prompt, upgrade panel.
- `style.css` — mobile-first responsive dark theme.

## License

MIT
