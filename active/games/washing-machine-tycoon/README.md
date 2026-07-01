# 🧺 Washing Machine Tycoon

**Design, manufacture, sell, and support washing machines over decades.**

Every machine you sell becomes a long-term responsibility. Your engineering choices determine whether customers become lifelong fans — or overwhelm your service department with warranty claims.

---

## How to Play

### Quick Start (Web)
Open `index.html` in any modern browser. No build tool, no server required.

### Via Launcher
If running from the megarepo launcher:
```
http://localhost/washing-machine
```

### Production
```bash
node server.mjs
# → http://localhost:3002
```

---

## Core Gameplay Loop

1. **Design a Machine** — Visit the Design Studio and choose every component: drum, motor, pump, bearings, suspension, control board, and exterior. Each choice affects cost, durability, noise, energy efficiency, and customer appeal.

2. **Start Production** — Assign the model to a production line. Balance speed vs. quality control. Faster production means more machines but higher defect rates.

3. **Sell & Support** — Machines are sold automatically. Each one ages in real-time, doing loads based on its owner's usage pattern (bachelor, family, Airbnb host, etc.).

4. **Handle Failures** — Components wear out. When a machine breaks, a warranty claim appears in your service department. How you handle it — repair, replace, discount, or decline — affects your reputation and bottom line.

5. **Grow Your Brand** — Reinvest profits into R&D, marketing, better components, and more technicians. Watch your reputation grow from "Unknown" to "Legendary."

---

## Features

### Product Design (7 component categories)
- **Drum:** Plastic, Stainless Steel, Reinforced Stainless
- **Motor:** Brushed DC, Brushless DC, Direct Drive
- **Pump:** Budget, Standard, Industrial
- **Bearings:** Economy, Standard, Premium Sealed, Magnetic Levitation
- **Suspension:** Basic Springs, Standard Dampers, Hydraulic Stabilisers
- **Control Board:** Mechanical Timer, Electronic Display, Smart WiFi, AI Load Sensing
- **Exterior:** Basic Knobs, Metal Knobs & Trim, Glass Door, Premium Finish

### Customer Archetypes (6 types)
Each with distinct load patterns, wear factors, price sensitivity, and patience for repairs:
- Bachelor, Family of Five, Airbnb Host, Laundromat Owner, Empty Nesters, Eco-Conscious

### Failure System (10 failure types)
Bearing failure, pump clogs, door latch breakage, hose leaks, control board failures, motor burnout, suspension collapse, stuck water valves, heating element failure, soap dispenser jams.

### Component Sourcing
Choose suppliers for each component category. Trade off cost vs. quality vs. lead time:
- Local Workshop, National Parts Co., German Precision GmbH, Shenzhen Mass Manufacturing, Osaka Precision Industries

### Regulations
New standards appear over time (Energy Star, Noise Ordinances, Water Conservation, RoHS, Right to Repair). Your designs must adapt or face penalties.

### Technology Tree
Unlock new components and capabilities as the decades pass:
1970s → Mechanical era → 1990s → Electronic era → 2000s → Smart era → 2010s+ → AI era

### Competitor AI
Five AI competitors with distinct strategies enter the market at different years:
- ValueMart Appliances (ultra-cheap)
- Rhine Industries (German engineering)
- Nexus Smart Living (smart home)
- Ironclad Industrial (commercial durability)
- GreenWave Appliances (eco-friendly)

### Machine Detail View
Click any machine to see its complete life story: serial number, model, age, loads completed, water and power used, failure history, satisfaction score, and total repair cost.

---

## Time Scale

- 1 day = 1 simulation tick
- Products last 5–20 years
- Game spans ~1970 to 2050+
- Technology, competitors, and regulations evolve with the calendar

---

## Key Metrics

| Metric | What It Measures |
|---|---|
| **Cash** | Your financial runway |
| **Reputation** | Brand trust (0–100) — affects sales and customer patience |
| **Customer Satisfaction** | Average across all active machines |
| **Market Share** | Your portion of the total addressable market |
| **Pending Claims** | Open warranty cases needing resolution |
| **Production Queue** | Finished machines waiting to be sold |

---

## Tips

- **Premium bearings** are the single best investment you can make. Cheap bearings cause catastrophic failures that destroy your reputation.
- **Quality control** slows production but dramatically reduces defect rates. A reputation takes years to build and days to lose.
- **Hire enough technicians** for your active machine base. Understaffed service regions lead to long repair times and angry customers.
- **Watch the regulations.** A machine that was great in 1995 might be illegal to sell in 1998.
- **Use the "Clone" button** on existing models as a starting point for new designs.

---

## Improvements Added

This implementation includes several mechanics beyond the original design doc:
- **Component Sourcing** — Supplier quality tiers affect real-world reliability
- **Regulation Events** — Government standards force periodic redesigns
- **Service Regions with Dispatch** — Regional technician allocation affects response times
- **Detailed Machine View** — Click any machine to see its life story

---

## File Structure

```
washing-machine-tycoon/
├── index.html       # Main HTML shell
├── style.css        # Industrial dark theme
├── server.mjs       # Node.js static server for launcher
└── js/
    ├── data.js      # Game constants, components, customers, etc.
    ├── game.js      # State management, model definitions
    ├── simulation.js# Tick engine, all game systems
    ├── ui.js        # Rendering and interaction (7 screens)
    └── main.js      # Entry point
```

---

## License

Part of the megarepo. See root-level license for details.
