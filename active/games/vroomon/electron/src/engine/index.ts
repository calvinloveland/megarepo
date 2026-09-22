/**
 * The vroomon engine.
 *
 * A small, headless-first top-down RPG kernel: tile maps and collision,
 * tile-by-tile actors, conversations and shops as data, NPC schedules, maze
 * generation, a herd book for DNA specimens, and versioned saves. It does not
 * know what a vroomon is, and it never touches the DOM — a renderer consumes
 * `Game.view()` and decides everything about how the world looks.
 *
 * The demo under `demo/` is a complete little game in one file, and is the
 * fastest way to see the intended shape of the API.
 */

export * from "./rng.js";
export * from "./grid.js";
export * from "./tiles.js";
export * from "./direction.js";
export * from "./schedule.js";
export * from "./map.js";
export * from "./actors.js";
export * from "./camera.js";
export * from "./inventory.js";
export * from "./dialogue.js";
export * from "./shop.js";
export * from "./maze.js";
export * from "./collection.js";
export * from "./save.js";
export * from "./input.js";
export * from "./scene.js";
export * from "./game.js";
