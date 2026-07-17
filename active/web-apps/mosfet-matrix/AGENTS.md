# MOSFET Matrix Designer

Web-based interactive design tool for the MOSFET switching matrix of a software-defined battery (SDB) with 4 cells.

## Start

```bash
cd active/web-apps/mosfet-matrix
node server.mjs
# → http://localhost:5117
```

## Architecture

- **Static server**: `server.mjs` — vanilla Node.js HTTP file server
- **Frontend**: `index.html` + `style.css` + `app.js` — single-page vanilla JS + SVG
- **No build step**, no dependencies

## Circuit Model

4 Li-ion cells configurable as:
- **4s** — all 4 in series (4× voltage, 1× capacity)
- **2s2p** — two 2s strings in parallel (2× voltage, 2× capacity)
- **4p** — all 4 in parallel (1× voltage, 4× capacity)

### Switch Matrix

| Group | Switches | Function |
|-------|----------|----------|
| CP1–CP4 | Bus-pos | Cell N+ ↔ V+ bus |
| CN1–CN4 | Bus-neg | Cell N- ↔ V- bus |
| S12–S34 | Series | Cell N- ↔ Cell N+1+ (series chain) |
| P12_T–P34_T | Parallel-top | Cell N+ ↔ Cell N+1+ |
| P12_B–P34_B | Parallel-bot | Cell N- ↔ Cell N+1- |

### Peripherals

- **Charger** — connect to pack (V+/V-) or individual cell
- **Current sense** — inline on V+ bus, V- bus, or per-cell
- **Voltage sense** — across any cell or the pack
