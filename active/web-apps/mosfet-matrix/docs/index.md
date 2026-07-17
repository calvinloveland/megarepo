# MOSFET Matrix Designer

**Interactive circuit design tool for a 4-cell software-defined battery MOSFET matrix.**

## Overview

A software-defined battery (SDB) uses a MOSFET switching matrix to dynamically reconfigure battery cells between series and parallel topologies. This tool helps design and visualize the switching matrix for a 4-cell system with the following capabilities:

- **4 topologies**: 4s, 2s2p, 4p, and custom (manual switch control)
- **14 MOSFET switches** with bus, series, and parallel connections
- **Peripheral integration**: charger, current sensing, voltage sensing
- **Live validation**: short-circuit detection, topology conformance, switch conflict warnings
- **SVG circuit schematic** with color-coded switch states

## Topologies

### 4 Series (4s)
All cells in series. 4× voltage, 1× capacity.

```
V+ ──CP1── [1] ─S12─ [2] ─S23─ [3] ─S34─ [4] ──CN4── V-
```

Active switches: CP1, S12, S23, S34, CN4

### 2 Series 2 Parallel (2s2p)
Two parallel strings of 2 cells each. 2× voltage, 2× capacity.

```
V+ ──CP1── [1] ─S12─ [2] ──CN2── V-
V+ ──CP3── [3] ─S34─ [4] ──CN4── V-
```

Active switches: CP1, S12, CN2, CP3, S34, CN4

### 4 Parallel (4p)
All cells in parallel. 1× voltage, 4× capacity.

```
V+ ────┬──CP1──┬──CP2──┬──CP3──┬──CP4──── V+
       [1]     [2]     [3]     [4]
V- ────┴──CN1──┴──CN2──┴──CN3──┴──CN4──── V-
```

Active switches: CP1, CP2, CP3, CP4, CN1, CN2, CN3, CN4

## Switch Matrix

| ID | Label | Connection | Type |
|----|-------|-----------|------|
| CP1 | CP₁ | Cell 1+ → V+ | Bus (top) |
| CP2 | CP₂ | Cell 2+ → V+ | Bus (top) |
| CP3 | CP₃ | Cell 3+ → V+ | Bus (top) |
| CP4 | CP₄ | Cell 4+ → V+ | Bus (top) |
| CN1 | CN₁ | Cell 1- → V- | Bus (bottom) |
| CN2 | CN₂ | Cell 2- → V- | Bus (bottom) |
| CN3 | CN₃ | Cell 3- → V- | Bus (bottom) |
| CN4 | CN₄ | Cell 4- → V- | Bus (bottom) |
| S12 | S₁₂ | Cell 1- → Cell 2+ | Series |
| S23 | S₂₃ | Cell 2- → Cell 3+ | Series |
| S34 | S₃₄ | Cell 3- → Cell 4+ | Series |
| P12_T | P₁₂ᵀ | Cell 1+ → Cell 2+ | Parallel (top) |
| P23_T | P₂₃ᵀ | Cell 2+ → Cell 3+ | Parallel (top) |
| P34_T | P₃₄ᵀ | Cell 3+ → Cell 4+ | Parallel (top) |
| P12_B | P₁₂ᴮ | Cell 1- → Cell 2- | Parallel (bottom) |
| P23_B | P₂₃ᴮ | Cell 2- → Cell 3- | Parallel (bottom) |
| P34_B | P₃₄ᴮ | Cell 3- → Cell 4- | Parallel (bottom) |

## Validation Rules

The tool checks for:

1. **Short circuit**: V+ directly connected to V- through switches only (no cells in the path)
2. **Cross-conduction**: Complementary switches in conflicting states (e.g., series and parallel switches both active between the same cells)
3. **Bypass hazard**: Cell that is bypassed (both terminals connected to the same bus rail) creating a short path

## Peripherals

- **Charger**: Connect to pack terminals or individual cell. Configurable with switch control.
- **Current sense**: Place inline on V+ bus, V- bus, or in series with a specific cell.
- **Voltage sense**: Measure individual cell voltage or pack voltage.

## Development

```bash
cd active/web-apps/mosfet-matrix
node server.mjs
```

Open http://localhost:5117 in your browser.
