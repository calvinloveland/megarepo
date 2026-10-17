/*
 * DOOM skin — a second face for the same protocol game.
 *
 * Nothing here touches the rules: it is a renderer plus a bit of DOM. The
 * tetris board keeps running underneath, and what it does drives the fight:
 * every line cleared is a hit, a Tetris is a shotgun blast, the stack height is
 * how close the demons get, and the level is how deep the corridor goes.
 *
 * The viewport is a real raycast: a 320x200 internal buffer (DOOM's resolution),
 * textured walls, a floor/ceiling gradient, depth-sorted sprites and a per-column
 * z-buffer, then upscaled with nearest-neighbour so it stays pixelated.
 *
 * Calvin Loveland · agent deepseek
 */

const VIEW_W = 320;
const VIEW_H = 200;
const BAR_H = 44; // status bar, drawn in DOM below the viewport

/* A small map. 1-4 are wall textures, 0 is open floor. The corridor runs north
 * from the player's start so demons walk straight at you. */
const MAP_ROWS = [
  '1111111111111111',
  '1..............1',
  '1.444444444444.1',
  '1.4..........4.1',
  '1.4..22..22..4.1',
  '1.4..........4.1',
  '1.4..........4.1',
  '1.4..33..33..4.1',
  '1.4..........4.1',
  '1.4..........4.1',
  '1.4..22..22..4.1',
  '1.4..........4.1',
  '1..............1',
  '1..............1',
  '1111111111111111',
  '1111111111111111',
];

const SKIN = {
  wall: {
    1: { base: [104, 96, 84], brick: [82, 74, 64], mortar: [58, 52, 46], band: [120, 44, 34] },
    2: { base: [96, 88, 80], brick: [70, 66, 60], mortar: [48, 44, 40], band: [70, 92, 44] },
    3: { base: [110, 100, 90], brick: [86, 74, 60], mortar: [52, 44, 36], band: [120, 44, 34] },
    4: { base: [126, 112, 96], brick: [96, 84, 70], mortar: [60, 52, 44], band: [130, 108, 40] },
  },
  demon: {
    I: [86, 168, 190],
    O: [212, 168, 60],
    T: [186, 104, 64],
    S: [96, 164, 128],
    Z: [166, 62, 50],
    J: [88, 112, 168],
    L: [176, 132, 84],
  },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ------------------------------------------------------------------ textures */

function makeWallTexture(spec, size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const [br, bg, bb] = spec.brick;
  ctx.fillStyle = `rgb(${spec.mortar[0]},${spec.mortar[1]},${spec.mortar[2]})`;
  ctx.fillRect(0, 0, size, size);
  const rows = 8;
  const rowH = size / rows;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (size / 6);
    const brickW = size / 3;
    for (let c = -1; c < 4; c++) {
      const x = c * brickW + offset + 1;
      const y = r * rowH + 1;
      const shade = 0.82 + 0.18 * Math.sin((r * 12.9898 + c * 78.233) * 43758.5453 % 6.28);
      ctx.fillStyle = `rgb(${Math.round(br * shade)},${Math.round(bg * shade)},${Math.round(bb * shade)})`;
      ctx.fillRect(x, y, brickW - 2, rowH - 2);
      ctx.fillStyle = 'rgba(255,255,255,.05)';
      ctx.fillRect(x, y, brickW - 2, 1);
    }
  }
  // Slime/blood band along the bottom, DOOM's favourite wall dressing.
  const grad = ctx.createLinearGradient(0, size * 0.72, 0, size);
  grad.addColorStop(0, `rgba(${spec.band[0]},${spec.band[1]},${spec.band[2]},0)`);
  grad.addColorStop(1, `rgba(${spec.band[0]},${spec.band[1]},${spec.band[2]},.85)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, size * 0.72, size, size * 0.28);
  for (let i = 0; i < 22; i++) {
    ctx.fillStyle = `rgba(${spec.band[0]},${spec.band[1]},${spec.band[2]},${0.3 + Math.random() * 0.5})`;
    const x = Math.random() * size;
    const h = 4 + Math.random() * 16;
    ctx.fillRect(x, size - h, 1 + Math.random() * 2, h);
  }
  return canvas;
}

/* ------------------------------------------------------------------- sprites */

/** A tetromino demon, drawn as blocks with eyes and teeth. */
function makeDemonSprite(type, size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const [r, g, b] = SKIN.demon[type] || [180, 60, 50];
  const lit = `rgb(${Math.min(255, r + 60)},${Math.min(255, g + 60)},${Math.min(255, b + 60)})`;
  const mid = `rgb(${r},${g},${b})`;
  const dark = `rgb(${Math.round(r * 0.45)},${Math.round(g * 0.45)},${Math.round(b * 0.45)})`;
  const s = size;
  // Blocky body: a fat square with two arms, in the spirit of a tetromino.
  const blocks = [
    [0.18, 0.26, 0.64, 0.5], // torso
    [0.06, 0.42, 0.16, 0.2], // left arm
    [0.78, 0.42, 0.16, 0.2], // right arm
    [0.28, 0.74, 0.16, 0.18], // left leg
    [0.56, 0.74, 0.16, 0.18], // right leg
    [0.3, 0.12, 0.4, 0.14], // brow
  ];
  for (const [x, y, w, h] of blocks) {
    ctx.fillStyle = mid;
    ctx.fillRect(x * s, y * s, w * s, h * s);
    ctx.fillStyle = dark;
    ctx.fillRect(x * s, (y + h) * s - 2, w * s, 2);
    ctx.fillStyle = lit;
    ctx.fillRect(x * s, y * s, w * s, 2);
  }
  // Eyes: glowing, angry.
  for (const ex of [0.34, 0.56]) {
    ctx.fillStyle = '#ffd34d';
    ctx.fillRect(ex * s, 0.34 * s, 0.1 * s, 0.09 * s);
    ctx.fillStyle = '#ff4a2a';
    ctx.fillRect((ex + 0.03) * s, 0.36 * s, 0.04 * s, 0.05 * s);
  }
  // Mouth with teeth.
  ctx.fillStyle = '#1a0a06';
  ctx.fillRect(0.32 * s, 0.56 * s, 0.36 * s, 0.12 * s);
  ctx.fillStyle = '#f0e6d0';
  for (let i = 0; i < 5; i++) ctx.fillRect((0.33 + i * 0.07) * s, 0.56 * s, 0.035 * s, 0.05 * s);
  return canvas;
}

function makeBloodSprite(size = 32) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < 16; i++) {
    const x = size / 2 + (Math.random() - 0.5) * size * 0.8;
    const y = size / 2 + (Math.random() - 0.5) * size * 0.8;
    const rr = 1 + Math.random() * 3.5;
    ctx.fillStyle = `rgba(${140 + Math.random() * 60},${10 + Math.random() * 20},${8 + Math.random() * 14},${0.6 + Math.random() * 0.4})`;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}

/** DOOM's status-bar face: pixel art, mood driven by health. */
function drawFace(ctx, x, y, scale, morale, hurt) {
  const px = (cx, cy, w, h, colour) => {
    ctx.fillStyle = colour;
    ctx.fillRect(x + cx * scale, y + cy * scale, w * scale, h * scale);
  };
  const skin = hurt > 0.6 ? '#8e3a2c' : '#c98a5c';
  px(3, 2, 10, 12, skin); // head
  px(2, 4, 1, 6, skin);
  px(13, 4, 1, 6, skin);
  px(3, 1, 10, 2, '#3a2a1c'); // hair
  px(5, 5, 2, 2, '#f2e3c0'); // eyes
  px(9, 5, 2, 2, '#f2e3c0');
  px(6, 5, 1, 1, '#1a1410');
  px(10, 5, 1, 1, '#1a1410');
  if (morale > 0.55) {
    px(5, 9, 6, 1, '#3a2a1c');
    px(5, 10, 1, 1, '#3a2a1c');
    px(10, 10, 1, 1, '#3a2a1c');
  } else if (morale > 0.25) {
    px(5, 10, 6, 1, '#3a2a1c');
  } else {
    px(5, 10, 2, 2, '#3a2a1c');
    px(9, 10, 2, 2, '#3a2a1c');
    px(7, 11, 2, 1, '#6a1a12');
  }
  if (hurt > 0.25) {
    px(4, 7, 1, 3, '#9e1a12'); // blood streak
    px(12, 4, 1, 4, '#9e1a12');
    px(8, 3, 2, 1, '#9e1a12');
  }
  if (hurt > 0.7) px(5, 8, 4, 1, '#9e1a12');
}

/* --------------------------------------------------------------------- skin */

export function createDoomSkin({ canvas, hud, body = document.body }) {
  const ctx = canvas.getContext('2d', { alpha: false });
  canvas.width = VIEW_W;
  canvas.height = VIEW_H;
  ctx.imageSmoothingEnabled = false;

  const wallTextures = {};
  for (const key of Object.keys(SKIN.wall)) wallTextures[key] = makeWallTexture(SKIN.wall[key]);
  const demonSprites = {};
  for (const type of Object.keys(SKIN.demon)) demonSprites[type] = makeDemonSprite(type);
  const bloodSprite = makeBloodSprite();

  const state = {
    player: { x: 8, y: 13.2, angle: -Math.PI / 2 },
    demons: [],
    blood: [],
    muzzle: 0,
    flash: 0,
    shake: 0,
    time: 0,
    kills: 0,
    depth: 1,
    health: 100,
    armor: 0,
    ammo: 0,
    morale: 1,
    hurt: 0,
    dead: false,
    message: '',
    messageTimer: 0,
    doorOpen: 0,
    spawnTimer: 1.5,
    lastLines: 0,
    lastLevel: 1,
    score: 0,
  };

  const rand = (a, b) => a + Math.random() * (b - a);

  /* ---------------------------------------------------------------- demons */

  function spawnDemon(type) {
    const kinds = type ? [type] : Object.keys(SKIN.demon);
    const sprite = kinds[Math.floor(Math.random() * kinds.length)];
    // Spawn down the corridor (north), at a distance that shrinks with the stack.
    const distance = rand(4.5, 8.5);
    const angle = rand(-0.34, 0.34);
    state.demons.push({
      type: sprite,
      x: state.player.x + Math.cos(state.player.angle + angle) * distance,
      y: state.player.y + Math.sin(state.player.angle + angle) * distance,
      distance,
      hp: 1,
      dying: 0,
      bob: Math.random() * Math.PI * 2,
      speed: rand(0.28, 0.6),
    });
  }

  function killNearest(count) {
    const alive = state.demons
      .filter((d) => d.dying === 0)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, count);
    for (const demon of alive) {
      demon.dying = 0.001;
      demon.hp = 0;
      state.kills += 1;
      state.demons.push(...bloodBurst(demon));
      state.muzzle = 1;
    }
    return alive.length;
  }

  function bloodBurst(demon) {
    const out = [];
    for (let i = 0; i < 6; i++) {
      out.push({
        x: demon.x + rand(-0.2, 0.2),
        y: demon.y + rand(-0.2, 0.2),
        distance: demon.distance,
        life: rand(0.3, 0.8),
        max: 0.8,
        scale: rand(0.1, 0.4),
        blood: true,
        bob: 0,
      });
    }
    return out;
  }

  /* ------------------------------------------------------------- external API */

  function setSkin(on) {
    body.dataset.skin = on ? 'doom' : 'steampunk';
    if (on) {
      state.demons.length = 0;
      state.blood.length = 0;
      state.health = 100;
      state.hurt = 0;
      state.dead = false;
      for (let i = 0; i < 3; i++) spawnDemon();
      paintHud();
    }
  }

  /** Called every frame with the protocol state and the engine's events. */
  function update(dt, protocolState, events = []) {
    state.time += dt;
    const level = protocolState ? protocolState.level : 1;
    const lines = protocolState ? protocolState.lines : 0;
    const height = protocolState && protocolState.board
      ? protocolState.board.findIndex((row) => row !== '..........')
      : 0;
    const stackHeight = height < 0 ? 0 : 20 - height;

    /* Tetris performance is the ammo: new lines cleared since last frame shoot. */
    if (lines > state.lastLines) {
      const gained = lines - state.lastLines;
      const killed = killNearest(gained >= 4 ? 4 : gained);
      state.ammo = Math.max(0, state.ammo - gained * 2);
      if (gained >= 4) {
        state.message = 'MULTI KILL!';
        state.messageTimer = 1.8;
        state.flash = Math.min(1, state.flash + 0.5);
        state.shake = Math.min(10, state.shake + 9);
      } else if (killed) {
        state.message = gained > 1 ? 'DOUBLE KILL' : 'KILL';
        state.messageTimer = 1.1;
        state.shake = Math.min(8, state.shake + 2.5 * gained);
      }
      state.health = clamp(state.health + gained * 1.5, 0, 100);
      state.hurt = clamp(state.hurt - gained * 0.12, 0, 1);
      state.lastLines = lines;
    }
    if (lines < state.lastLines) state.lastLines = lines; // new game

    if (level !== state.lastLevel) {
      if (level > state.lastLevel) {
        state.depth = level;
        state.doorOpen = 1;
        state.message = `ENTERING E1M${level}`;
        state.messageTimer = 2.2;
        state.armor = Math.min(200, state.armor + 25);
        state.health = clamp(state.health + 12, 0, 100);
      }
      state.lastLevel = level;
      // Deeper corridors spawn demons faster.
      state.spawnTimer = Math.min(state.spawnTimer, 0.6);
    }

    state.score = protocolState ? protocolState.score : 0;
    // One round per piece placed, two spent per kill: you are always a little short.
    const pieces = protocolState ? protocolState.piece_count : 0;
    state.ammo = Math.max(0, Math.min(999, pieces - state.kills * 2 + 6));
    state.doorOpen = Math.max(0, state.doorOpen - dt * 0.7);

    /* Demons close in. A tall stack is a losing position, so they move faster. */
    const pressure = 1 + stackHeight / 12;
    state.spawnTimer -= dt * pressure;
    if (state.spawnTimer <= 0 && state.demons.filter((d) => !d.dying).length < 7) {
      spawnDemon();
      state.spawnTimer = Math.max(1.1, 4.2 - level * 0.16 - stackHeight * 0.06);
    }

    for (const demon of state.demons) {
      if (demon.blood) {
        demon.life -= dt;
        demon.distance -= dt * 0.6;
        continue;
      }
      if (demon.dying > 0) {
        demon.dying += dt;
        continue;
      }
      demon.distance -= dt * demon.speed * pressure;
      if (demon.distance < 1.4 && !state.dead) {
        demon.distance = 1.4;
        state.health -= 9 * dt * 6;
        state.hurt = clamp(state.hurt + dt * 0.5, 0, 1);
        state.flash = Math.min(1, state.flash + dt * 1.4);
      }
    }
    state.demons = state.demons.filter((d) => (d.blood ? d.life > 0 : d.dying < 0.55));
    if (state.demons.length > 40) state.demons.splice(0, state.demons.length - 40);

    if (state.health <= 0 && !state.dead) {
      state.dead = true;
      state.message = 'YOU DIED';
      state.messageTimer = 9;
    }
    if (state.dead && protocolState && !protocolState.game_over) {
      // Back on your feet: the marathon keeps going.
      state.dead = false;
      state.health = 60;
      state.hurt = 0.6;
    }

    state.hurt = clamp(state.hurt - dt * 0.03, 0, 1);
    state.morale = clamp(state.health / 100, 0, 1);
    state.muzzle = Math.max(0, state.muzzle - dt * 6);
    state.flash = Math.max(0, state.flash - dt * 2.2);
    state.shake = Math.max(0, state.shake - dt * 22);
    state.messageTimer = Math.max(0, state.messageTimer - dt);
    void events;
  }

  /* --------------------------------------------------------------- raycast */

  function castRay(px, py, angle) {
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    let mapX = Math.floor(px);
    let mapY = Math.floor(py);
    const deltaX = Math.abs(1 / (dirX || 1e-9));
    const deltaY = Math.abs(1 / (dirY || 1e-9));
    let stepX;
    let stepY;
    let sideX;
    let sideY;
    if (dirX < 0) {
      stepX = -1;
      sideX = (px - mapX) * deltaX;
    } else {
      stepX = 1;
      sideX = (mapX + 1 - px) * deltaX;
    }
    if (dirY < 0) {
      stepY = -1;
      sideY = (py - mapY) * deltaY;
    } else {
      stepY = 1;
      sideY = (mapY + 1 - py) * deltaY;
    }
    let side = 0;
    let hits = 0;
    while (hits++ < 64) {
      if (sideX < sideY) {
        sideX += deltaX;
        mapX += stepX;
        side = 0;
      } else {
        sideY += deltaY;
        mapY += stepY;
        side = 1;
      }
      const row = MAP_ROWS[mapY] || '';
      const cell = row[mapX] || '1';
      if (cell !== '.' && cell !== '0') {
        const dist = side === 0 ? sideX - deltaX : sideY - deltaY;
        // Where along the wall the ray landed, for texture sampling.
        const wallX = side === 0 ? py + dist * dirY : px + dist * dirX;
        return { cell, dist: Math.max(0.0001, dist), side, wallX: wallX - Math.floor(wallX), dirX, dirY };
      }
    }
    return null;
  }

  function drawWorld() {
    const horizon = VIEW_H / 2;
    // Ceiling and floor, DOOM-style dark gradients with a vignette.
    const ceiling = ctx.createLinearGradient(0, 0, 0, horizon);
    ceiling.addColorStop(0, '#0a0806');
    ceiling.addColorStop(1, '#241c16');
    ctx.fillStyle = ceiling;
    ctx.fillRect(0, 0, VIEW_W, horizon);
    const floor = ctx.createLinearGradient(0, horizon, 0, VIEW_H);
    floor.addColorStop(0, '#221a14');
    floor.addColorStop(1, '#080605');
    ctx.fillStyle = floor;
    ctx.fillRect(0, horizon, VIEW_W, VIEW_H - horizon);

    // Floor and ceiling perspective: a few converging seams, cheap but effective.
    ctx.strokeStyle = 'rgba(120,96,70,.18)';
    ctx.lineWidth = 1;
    for (let i = -6; i <= 6; i++) {
      const x = VIEW_W / 2 + i * (VIEW_W / 6.5);
      ctx.beginPath();
      ctx.moveTo(VIEW_W / 2 + i * 3, horizon);
      ctx.lineTo(x, VIEW_H);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(VIEW_W / 2 + i * 3, horizon);
      ctx.lineTo(x, 0);
      ctx.stroke();
    }
    for (let i = 1; i < 9; i++) {
      const y = horizon + Math.pow(i / 9, 2.1) * (VIEW_H - horizon);
      ctx.strokeStyle = `rgba(120,96,70,${0.2 - i * 0.02})`;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(VIEW_W, y);
      ctx.stroke();
      const yc = horizon - Math.pow(i / 9, 2.1) * horizon;
      ctx.beginPath();
      ctx.moveTo(0, yc);
      ctx.lineTo(VIEW_W, yc);
      ctx.stroke();
    }

    const depth = new Float32Array(VIEW_W);
    const fov = Math.PI / 3;
    for (let x = 0; x < VIEW_W; x++) {
      const cameraX = (2 * x) / VIEW_W - 1;
      const angle = state.player.angle + Math.atan(cameraX * Math.tan(fov / 2));
      const hit = castRay(state.player.x, state.player.y, angle);
      if (!hit) {
        depth[x] = 64;
        continue;
      }
      // Correct fisheye.
      const corrected = hit.dist * Math.cos(angle - state.player.angle);
      depth[x] = corrected;
      const height = Math.min(VIEW_H * 2, (VIEW_H / corrected) * 0.9);
      const top = horizon - height / 2;
      const spec = SKIN.wall[hit.cell] || SKIN.wall[1];
      // Shade by distance and by which face we hit (N/S darker, like DOOM).
      const light = clamp(1.25 - corrected / 9, 0.18, 1) * (hit.side ? 0.72 : 1);
      const tex = wallTextures[hit.cell] || wallTextures[1];
      const texX = Math.floor(hit.wallX * tex.width);
      ctx.drawImage(tex, texX, 0, 1, tex.height, x, top, 1, height);
      ctx.fillStyle = `rgba(0,0,0,${1 - light})`;
      ctx.fillRect(x, top, 1, height);
      // A hot red line where the wall meets the floor adds depth.
      ctx.fillStyle = `rgba(120,20,10,${0.16 * light})`;
      ctx.fillRect(x, top + height - 1, 1, 1);
      void spec;
    }
    return depth;
  }

  function drawSprites(depth) {
    const fov = Math.PI / 3;
    const sprites = state.demons
      .map((d) => ({ ...d, dist: Math.hypot(d.x - state.player.x, d.y - state.player.y) }))
      .sort((a, b) => b.dist - a.dist);

    for (const sprite of sprites) {
      const dx = sprite.x - state.player.x;
      const dy = sprite.y - state.player.y;
      let angle = Math.atan2(dy, dx) - state.player.angle;
      while (angle > Math.PI) angle -= Math.PI * 2;
      while (angle < -Math.PI) angle += Math.PI * 2;
      if (Math.abs(angle) > fov * 0.72) continue;
      const corrected = sprite.dist;
      const screenX = VIEW_W / 2 + Math.tan(angle) * (VIEW_W / 2) / Math.tan(fov / 2);
      // One world unit of height at this distance, then anchor the demon's feet
      // to the floor line so it stands in the corridor instead of hovering.
      const unit = (VIEW_H / corrected) * 0.9;
      const size = Math.min(VIEW_H * 1.8, unit * (sprite.blood ? 0.3 : 0.66));
      const floorY = VIEW_H / 2 + unit / 2;
      const hover = Math.sin(state.time * 3 + sprite.bob) * size * 0.03;
      const top = sprite.blood ? floorY - size : floorY - size + hover;
      const left = screenX - size / 2;
      const x0 = Math.max(0, Math.floor(left));
      const x1 = Math.min(VIEW_W, Math.ceil(left + size));
      const image = sprite.blood
        ? bloodSprite
        : demonSprites[sprite.type] || demonSprites.T;
      const fade = sprite.blood
        ? clamp(sprite.life / sprite.max, 0, 1)
        : sprite.dying > 0 ? clamp(1 - sprite.dying / 0.55, 0, 1) : 1;
      if (fade <= 0) continue;
      for (let x = x0; x < x1; x++) {
        if (corrected > depth[x]) continue; // behind a wall
        const u = (x - left) / size;
        const sx = Math.floor(clamp(u, 0, 0.999) * image.width);
        ctx.globalAlpha = fade;
        ctx.drawImage(image, sx, 0, 1, image.height, x, top, 1, size);
      }
      ctx.globalAlpha = 1;
    }
  }

  /** The plasma rifle, bottom centre, bobbing and recoiling. */
  function drawWeapon() {
    const recoil = state.muzzle * 9;
    const bob = Math.sin(state.time * 3.4) * 3 + Math.sin(state.time * 1.7) * 2;
    const cx = VIEW_W / 2;
    const base = VIEW_H + bob + recoil;
    ctx.save();
    // Barrel and heat shield
    ctx.fillStyle = '#22201d';
    ctx.fillRect(cx - 6, base - 66, 12, 54);
    ctx.fillStyle = '#3d372f';
    ctx.fillRect(cx - 4, base - 64, 3, 50);
    ctx.fillStyle = '#2a2622';
    for (let i = 0; i < 5; i++) ctx.fillRect(cx - 8, base - 62 + i * 9, 16, 3);
    // Receiver and hands
    ctx.fillStyle = '#4a4136';
    ctx.fillRect(cx - 24, base - 36, 48, 12);
    ctx.fillStyle = '#5a4a3a';
    ctx.fillRect(cx - 26, base - 24, 52, 24);
    ctx.fillStyle = '#6f5c46';
    ctx.fillRect(cx - 26, base - 24, 52, 5);
    ctx.fillStyle = '#2f2a24';
    ctx.fillRect(cx - 3, base - 40, 6, 8);
    // Muzzle glow
    if (state.muzzle > 0.02) {
      const g = ctx.createRadialGradient(cx, base - 60, 1, cx, base - 60, 34);
      g.addColorStop(0, `rgba(190,255,170,${0.9 * state.muzzle})`);
      g.addColorStop(0.4, `rgba(90,255,120,${0.45 * state.muzzle})`);
      g.addColorStop(1, 'rgba(40,160,60,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - 40, base - 100, 80, 80);
    }
    ctx.restore();
  }

  function drawOverlay() {
    // Muzzle flash when a clear fires a shot.
    if (state.muzzle > 0) {
      ctx.fillStyle = `rgba(255,214,140,${0.35 * state.muzzle})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.fillStyle = `rgba(255,140,40,${0.25 * state.muzzle})`;
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        ctx.fillRect(VIEW_W / 2 + Math.cos(a) * 40 * (1.2 - state.muzzle), VIEW_H / 2 + Math.sin(a) * 26 * (1.2 - state.muzzle), 3, 3);
      }
    }
    // Damage flash.
    if (state.flash > 0) {
      ctx.fillStyle = `rgba(150,10,6,${0.62 * state.flash})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    // Crosshair.
    ctx.fillStyle = 'rgba(230,220,200,.55)';
    ctx.fillRect(VIEW_W / 2 - 1, VIEW_H / 2 - 5, 2, 10);
    ctx.fillRect(VIEW_W / 2 - 5, VIEW_H / 2 - 1, 10, 2);

    // Kill / depth messages, DOOM caps.
    if (state.messageTimer > 0 && state.message) {
      ctx.font = 'bold 13px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(0, VIEW_H * 0.16, VIEW_W, 20);
      ctx.fillStyle = state.dead ? '#ff2a1a' : '#ffd34d';
      ctx.fillText(state.message, VIEW_W / 2, VIEW_H * 0.16 + 15);
    }
    if (state.dead) {
      ctx.fillStyle = 'rgba(60,0,0,.45)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  }

  /* ------------------------------------------------------------------- HUD */

  function paintHud() {
    hud.innerHTML = '';
    const face = document.createElement('canvas');
    face.width = 64;
    face.height = 64;
    face.className = 'doom-face';
    const fctx = face.getContext('2d');
    fctx.fillStyle = '#3a2f26';
    fctx.fillRect(0, 0, 64, 64);
    drawFace(fctx, 20, 4, 2.3, state.morale, state.hurt + (state.dead ? 1 : 0));
    if (state.dead) {
      fctx.fillStyle = 'rgba(120,10,8,.75)';
      fctx.fillRect(0, 0, 64, 64);
    }

    const cell = (label, value, extra = '') => {
      const div = document.createElement('div');
      div.className = `doom-cell ${extra}`;
      div.innerHTML = `<span>${label}</span><b>${value}</b>`;
      return div;
    };

    hud.append(
      cell('AMMO', String(Math.max(0, state.ammo)).padStart(3, '0')),
      cell('HEALTH', `${Math.max(0, Math.round(state.health))}%`, state.health < 35 ? 'bad' : ''),
      face,
      cell('ARMS', String(2 + Math.min(4, state.depth >> 1))),
      cell('ARMOR', `${Math.round(state.armor)}%`),
      cell('KILLS', String(state.kills)),
      cell('E1M' + state.depth, `${Math.round(state.score).toLocaleString('en-US')}`, 'wide'),
    );
  }

  function draw() {
    const shakeX = state.shake > 0 ? (Math.random() - 0.5) * state.shake : 0;
    const shakeY = state.shake > 0 ? (Math.random() - 0.5) * state.shake * 0.6 : 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.save();
    ctx.translate(shakeX, shakeY);
    const depth = drawWorld();
    drawSprites(depth);
    drawWeapon();
    drawOverlay();
    ctx.restore();
    paintHud();
  }

  return {
    setSkin,
    update,
    draw,
    get state() { return state; },
    /** For tests: force a monster right in your face. */
    debugSpawnAt(distance) {
      spawnDemon();
      const last = state.demons[state.demons.length - 1];
      last.distance = distance;
      last.x = state.player.x + Math.cos(state.player.angle) * distance;
      last.y = state.player.y + Math.sin(state.player.angle) * distance;
    },
    BAR_H,
  };
}
