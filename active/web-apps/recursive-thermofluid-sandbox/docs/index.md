# Recursive Thermofluid Sandbox

A web sandbox for exploring **emergent thermofluid machines** built from a single active part: the wheel.

## Concept

The app models a recursively nested 3×3 world where each cell can contain:

- gas
- liquid
- heat
- walls/materials
- a wheel
- another 3×3 grid

Parent cells aggregate child properties so simulation detail can increase where pressure, heat, wheel motion, or phase changes become interesting.

## Prototype scope

This first version focuses on playability and emergence:

- paint wheels, walls, heat, gas, and liquid
- switch among water/steam, air, and refrigerant-like fluids
- inspect pressure, temperature, velocity, and phase changes
- watch active regions subdivide into deeper simulation cells
- use presets as starting points for pumps, compressors, turbines, refrigerators, and steam loops

## Running

```bash
npm run start
```

Default port:

- `5192`
