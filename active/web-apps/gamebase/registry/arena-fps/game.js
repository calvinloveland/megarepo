/*
 * Arena FPS — Gamebase
 *
 * A real-time first-person deathmatch. The arena is a Wolfenstein/Doom-style
 * raycast grid rendered to a 2D canvas; remote players are billboards that are
 * interpolated between the ~15 Hz `state` messages relayed by the Gamebase
 * real-time room (see Gamebase.joinRealtime). There is no server-side
 * simulation: each client owns its own health and announces its own death.
 *
 * The game keeps a small debug surface on `window.ArenaFPS` so the online flow
 * can be driven deterministically from an automated browser test.
 */
(function () {
  "use strict";

  // ── Arena map ─────────────────────────────────────────────────────────────
  const MAP_SRC = [
    "####################",
    "#..................#",
    "#..................#",
    "#..###..####..###..#",
    "#..................#",
    "#..................#",
    "#..###..####..###..#",
    "#..................#",
    "#..................#",
    "#..###..####..###..#",
    "#..................#",
    "#..................#",
    "#..###..####..###..#",
    "#..................#",
    "#..................#",
    "#..###..####..###..#",
    "#..................#",
    "#..................#",
    "#..................#",
    "####################",
  ];
  const MAP_H = MAP_SRC.length;
  const MAP_W = MAP_SRC[0].length;
  MAP_SRC.forEach((row, index) => {
    if (row.length !== MAP_W) throw new Error("arena map row " + index + " has width " + row.length);
  });

  const SPAWNS = [
    [2.5, 2.5], [MAP_W - 2.5, 2.5],
    [2.5, MAP_H - 2.5], [MAP_W - 2.5, MAP_H - 2.5],
    [9.5, 1.5], [MAP_W / 2, MAP_H - 1.5],
  ];

  // ── Tuning ────────────────────────────────────────────────────────────────
  const FOV = Math.PI / 3;
  const MOVE_SPEED = 3.4;
  const PLAYER_RADIUS = 0.28;
  const HIT_RADIUS = 0.42;
  const MAX_RANGE = 30;
  const DMG = 25;
  const FIRE_COOLDOWN = 0.26;
  const FRAG_LIMIT = 10;
  const MATCH_SECONDS = 180;
  const RESPAWN_SECONDS = 2.5;
  const SEND_HZ = 15;
  const INTERP_DELAY = 110;
  const MOUSE_SENS = 0.0022;

  // ── Small helpers ─────────────────────────────────────────────────────────
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const round2 = (v) => Math.round(v * 100) / 100;
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const angleDelta = (a, b) => {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  };
  const tileAt = (tx, ty) => {
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return "#";
    return MAP_SRC[ty][tx];
  };
  const isWall = (x, y) => tileAt(Math.floor(x), Math.floor(y)) === "#";
  const blocked = (x, y) => {
    const r = PLAYER_RADIUS;
    return isWall(x - r, y - r) || isWall(x + r, y - r) || isWall(x - r, y + r) || isWall(x + r, y + r);
  };

  function castRay(ox, oy, rdx, rdy) {
    let mapX = Math.floor(ox);
    let mapY = Math.floor(oy);
    const deltaX = rdx === 0 ? Infinity : Math.abs(1 / rdx);
    const deltaY = rdy === 0 ? Infinity : Math.abs(1 / rdy);
    let stepX, stepY, sideX, sideY;
    if (rdx < 0) { stepX = -1; sideX = (ox - mapX) * deltaX; }
    else { stepX = 1; sideX = (mapX + 1 - ox) * deltaX; }
    if (rdy < 0) { stepY = -1; sideY = (oy - mapY) * deltaY; }
    else { stepY = 1; sideY = (mapY + 1 - oy) * deltaY; }

    let side = 0;
    let hit = false;
    let guard = 0;
    while (!hit && guard++ < 512) {
      if (sideX < sideY) { sideX += deltaX; mapX += stepX; side = 0; }
      else { sideY += deltaY; mapY += stepY; side = 1; }
      if (isWall(mapX, mapY)) hit = true;
    }
    let dist;
    if (side === 0) dist = (mapX - ox + (1 - stepX) / 2) / (rdx || 1e-9);
    else dist = (mapY - oy + (1 - stepY) / 2) / (rdy || 1e-9);
    if (!Number.isFinite(dist) || dist < 0.0001) dist = 0.0001;
    return { dist, side, mapX, mapY };
  }

  // ── World state ───────────────────────────────────────────────────────────
  const world = {
    phase: "menu", // menu | finding | waiting | playing | over
    matchId: null,
    myId: null,
    oppId: null,
    oppName: "OPP",
    channel: null,
    myHandle: "···",
    remotes: Object.create(null),
    roster: [],
    decals: [],
    matchStart: 0,
    reported: false,
    ending: false,
    keys: Object.create(null),
    locked: false,
    pitch: 0,
    sendAcc: 0,
    started: false,
    lastMuzzle: 0,
    me: {
      x: 2.5, y: 2.5, a: 0,
      hp: 100, alive: true,
      frags: 0, deaths: 0,
      fireCooldown: 0, muzzle: 0, hitmarker: 0,
      respawnAt: 0,
    },
  };

  const manualUnlocks = new Set();

  // ── DOM ───────────────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const canvas = $("scene");
  const ctx = canvas.getContext("2d", { alpha: false });
  const els = {
    hud: $("hud"),
    hpFill: $("hp-fill"),
    hpText: $("hp-text"),
    timer: $("timer"),
    myFrags: $("my-frags"),
    oppFrags: $("opp-frags"),
    oppName: $("opp-name"),
    oppHpFill: $("opp-hp-fill"),
    crosshair: $("crosshair"),
    hitmarker: $("hitmarker"),
    killfeed: $("killfeed"),
    toast: $("toast"),
    lockHint: $("lock-hint"),
    overlay: $("overlay"),
    overlayTitle: $("overlay-title"),
    overlayBody: $("overlay-body"),
    overlayStatus: $("overlay-status"),
    overlayBtn: $("overlay-btn"),
    connectHint: $("connect-hint"),
  };

  let backdrop = null;

  // ── Overlay / HUD helpers ─────────────────────────────────────────────────
  function setOverlay(title, body, { button = null, status = "", logo = true } = {}) {
    els.overlayTitle.textContent = title;
    els.overlayBody.textContent = body;
    if (button) {
      els.overlayBtn.hidden = false;
      els.overlayBtn.textContent = button;
    } else {
      els.overlayBtn.hidden = true;
    }
    els.overlayStatus.textContent = status;
    els.overlay.querySelector(".overlay-logo").style.display = logo ? "" : "none";
    els.overlay.hidden = false;
  }

  function hideOverlay() {
    els.overlay.hidden = true;
  }

  function setStatus(text) {
    els.overlayStatus.textContent = text;
  }

  function pushKill(text, bad) {
    const line = document.createElement("div");
    line.className = "kill-line" + (bad ? " bad" : "");
    line.textContent = text;
    els.killfeed.appendChild(line);
    while (els.killfeed.children.length > 5) els.killfeed.removeChild(els.killfeed.firstChild);
    setTimeout(() => line.remove(), 4000);
  }

  let toastTimer = null;
  function toast(text) {
    els.toast.textContent = text;
    els.toast.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 1200);
  }

  // ── Networking ────────────────────────────────────────────────────────────
  function send(message) {
    if (world.channel) {
      try { world.channel.send(message); } catch (error) { /* socket gone */ }
    }
  }

  function sendState() {
    const me = world.me;
    send({ t: "state", x: round2(me.x), y: round2(me.y), a: round2(me.a), hp: Math.round(me.hp) });
  }

  function remoteFor(id, name) {
    let remote = world.remotes[id];
    if (!remote) {
      remote = {
        id, name: name || "OPP", hp: 100, alive: true,
        x: 0, y: 0, a: 0, samples: [], flash: 0,
      };
      world.remotes[id] = remote;
    }
    return remote;
  }

  function onMessage(data) {
    if (!data || typeof data !== "object" || typeof data.t !== "string") return;
    if (data.t === "state") {
      const remote = remoteFor(data.from);
      const sample = {
        time: now(),
        x: Number(data.x) || 0,
        y: Number(data.y) || 0,
        a: Number(data.a) || 0,
        hp: Number(data.hp) || 0,
      };
      remote.samples.push(sample);
      if (remote.samples.length > 40) remote.samples.shift();
      remote.hp = sample.hp;
      remote.alive = sample.hp > 0;
      return;
    }
    if (data.t === "hello") {
      const remote = remoteFor(data.from);
      remote.name = String(data.name || remote.name).slice(0, 10);
      return;
    }
    if (data.t === "shot") {
      if (data.target !== world.myId) return;
      applyDamage(Number(data.dmg) || DMG);
      return;
    }
    if (data.t === "kill") {
      if (data.victim === world.myId) return; // the relay excludes the sender
      world.me.frags += 1;
      if (world.me.frags === 1) {
        manualUnlocks.add("first-blood");
        toast("FIRST BLOOD");
      }
      pushKill(world.oppName + " was fragged", false);
      checkFragLimit();
      return;
    }
  }

  function applyDamage(dmg) {
    const me = world.me;
    if (world.phase !== "playing" || !me.alive) return;
    me.hp = Math.max(0, me.hp - dmg);
    if (me.hp > 0) return;
    me.alive = false;
    me.deaths += 1;
    me.respawnAt = now() + RESPAWN_SECONDS * 1000;
    send({ t: "kill", victim: world.myId });
    pushKill(world.oppName + " fragged you", true);
    if (me.deaths >= FRAG_LIMIT) finishMatch(false);
  }

  function checkFragLimit() {
    if (world.me.frags >= FRAG_LIMIT) finishMatch(true);
  }

  function finishMatch(win) {
    if (world.phase !== "playing" || world.ending) return;
    world.ending = true;
    world.phase = "over";
    const result = win === null ? "draw" : win ? "win" : "loss";
    if (win === true) manualUnlocks.add("victor");
    closeChannel();
    hideHud();
    reportResult(result);
    setOverlay(
      result === "win" ? "Victory" : result === "loss" ? "Defeat" : "Draw",
      `Frags ${world.me.frags} · Deaths ${world.me.deaths} · ${result === "win" ? "You dominated the arena." : result === "loss" ? "The other player got you." : "Dead even."}`,
      { button: "Rematch", status: "" }
    );
  }

  function reportResult(result) {
    if (world.reported) return;
    world.reported = true;
    if (world.matchId) {
      Gamebase.reportResult(world.matchId, {
        result, frags: world.me.frags, deaths: world.me.deaths,
      }).catch((error) => console.warn("[arena-fps] reportResult failed", error));
    }
    Gamebase.endRun({
      score: world.me.frags,
      meta: { result, mode: "online", kills: world.me.frags, deaths: world.me.deaths },
      unlock: Array.from(manualUnlocks),
    }).catch((error) => console.warn("[arena-fps] endRun failed", error));
  }

  function closeChannel() {
    if (world.channel) {
      const channel = world.channel;
      world.channel = null;
      try { channel.close(); } catch (error) { /* already closed */ }
    }
  }

  // ── Match lifecycle ───────────────────────────────────────────────────────
  function resetMe() {
    const me = world.me;
    me.hp = 100;
    me.alive = true;
    me.frags = 0;
    me.deaths = 0;
    me.fireCooldown = 0;
    me.muzzle = 0;
    me.hitmarker = 0;
    me.respawnAt = 0;
  }

  function pickSpawn(flee) {
    let best = SPAWNS[Math.floor(Math.random() * SPAWNS.length)];
    if (!flee) return best;
    let bestDist = -1;
    for (const spawn of SPAWNS) {
      const d = Math.hypot(spawn[0] - flee.x, spawn[1] - flee.y);
      if (d > bestDist) { bestDist = d; best = spawn; }
    }
    return best;
  }

  function nearestRemote() {
    let found = null;
    for (const id in world.remotes) {
      const remote = world.remotes[id];
      if (!remote.alive) continue;
      found = remote;
      break;
    }
    return found;
  }

  function spawnMe(initial) {
    const remote = initial ? null : nearestRemote();
    const spawn = remote && !(remote.x === 0 && remote.y === 0) ? pickSpawn(remote) : pickSpawn();
    const me = world.me;
    me.x = spawn[0];
    me.y = spawn[1];
    me.a = Math.atan2(MAP_H / 2 - me.y, MAP_W / 2 - me.x);
    me.hp = 100;
    me.alive = true;
    me.respawnAt = 0;
    sendState();
  }

  function startArena() {
    if (world.started) return;
    world.started = true;
    world.phase = "playing";
    world.ending = false;
    world.matchStart = now();
    resetMe();
    spawnMe(true);
    world.sendAcc = 0;
    hideOverlay();
    els.hud.hidden = false;
    els.crosshair.hidden = false;
    els.lockHint.hidden = false;
    send({ t: "hello", name: world.myHandle });
    toast("FIGHT");
  }

  async function startOnline() {
    closeChannel();
    world.remotes = Object.create(null);
    world.roster = [];
    world.started = false;
    world.ending = false;
    world.reported = false;
    world.decals = [];
    world.phase = "finding";
    resetMe();
    hideHud();
    setOverlay("Finding an opponent…", "Searching for another player in the queue.", { status: "Finding an opponent…" });
    try {
      await Gamebase.ready();
      world.myHandle = (Gamebase.player && Gamebase.player.handle) || "···";
      await Gamebase.findMatch();
      setStatus("Waiting for an opponent…");
      const match = await Gamebase.waitForMatch({ timeout: 120000 });
      if (!match) {
        world.phase = "menu";
        setOverlay("No opponent found", "Nobody joined the queue in time.", { button: "Try again", status: "" });
        return;
      }
      world.matchId = match.id;
      world.myId = Gamebase.player.id;
      const opponent = (match.players || []).find((p) => p.player_id !== world.myId) || {};
      world.oppId = opponent.player_id || null;
      world.oppName = String(opponent.handle || "OPP").toUpperCase().slice(0, 10);
      if (world.oppId) remoteFor(world.oppId, world.oppName);
      world.phase = "waiting";
      setOverlay("Waiting for opponent…", "Your opponent found the match. Waiting for them to connect.", { status: "Waiting for opponent…" });

      const channel = await Gamebase.joinRealtime(match.id);
      world.channel = channel;
      channel.on("open", () => {
        send({ t: "hello", name: world.myHandle });
        sendState();
      });
      channel.on("roster", (players) => {
        world.roster = players || [];
        setStatus(world.roster.length >= 2 ? "" : "Waiting for opponent…");
        if (world.roster.length >= 2 && !world.started) startArena();
        else if (world.started && world.roster.length < 2 && !world.ending) {
          finishMatch(true);
        }
      });
      channel.on("message", onMessage);
      channel.on("close", () => {
        if (world.phase === "playing" && !world.ending) pushKill("Connection lost", true);
      });
    } catch (error) {
      console.warn("[arena-fps] matchmaking failed", error);
      world.phase = "menu";
      setOverlay("Matchmaking failed", String(error && error.message ? error.message : error), { button: "Try again", status: "" });
    }
  }

  // ── Simulation ────────────────────────────────────────────────────────────
  function fireOnce() {
    const me = world.me;
    if (world.phase !== "playing" || !me.alive) return;
    if (me.fireCooldown > 0) return;
    me.fireCooldown = FIRE_COOLDOWN;
    me.muzzle = 0.06;

    const dirX = Math.cos(me.a);
    const dirY = Math.sin(me.a);
    let bestHit = null;
    for (const id in world.remotes) {
      const remote = world.remotes[id];
      if (!remote.alive) continue;
      const vx = remote.x - me.x;
      const vy = remote.y - me.y;
      const along = vx * dirX + vy * dirY;
      if (along <= 0 || along > MAX_RANGE) continue;
      const perp = Math.abs(vx * dirY - vy * dirX);
      if (perp > HIT_RADIUS) continue;
      if (!bestHit || along < bestHit.along) bestHit = { along, id };
    }

    const wall = castRay(me.x, me.y, dirX, dirY);
    if (bestHit && bestHit.along < wall.dist) {
      send({ t: "shot", target: bestHit.id, dmg: DMG });
      me.hitmarker = 0.16;
      toast("HIT");
      return;
    }
    // Wall impact: leave a small decal.
    const hx = me.x + dirX * Math.max(0.05, wall.dist - 0.03);
    const hy = me.y + dirY * Math.max(0.05, wall.dist - 0.03);
    world.decals.push({ x: hx, y: hy, side: wall.side });
    if (world.decals.length > 48) world.decals.shift();
  }

  function update(dt) {
    const me = world.me;

    if (world.phase === "playing") {
      const elapsed = (now() - world.matchStart) / 1000;
      if (elapsed >= MATCH_SECONDS) {
        const win = me.frags > me.deaths ? true : me.frags < me.deaths ? false : null;
        finishMatch(win);
      }
    }

    if (me.fireCooldown > 0) me.fireCooldown = Math.max(0, me.fireCooldown - dt);
    if (me.muzzle > 0) me.muzzle = Math.max(0, me.muzzle - dt);
    if (me.hitmarker > 0) me.hitmarker = Math.max(0, me.hitmarker - dt);

    if (world.phase === "playing" && me.alive) {
      let fx = 0, fy = 0;
      const keys = world.keys;
      if (keys.KeyW || keys.ArrowUp) { fx += Math.cos(me.a); fy += Math.sin(me.a); }
      if (keys.KeyS || keys.ArrowDown) { fx -= Math.cos(me.a); fy -= Math.sin(me.a); }
      if (keys.KeyD || keys.ArrowRight) { fx += -Math.sin(me.a); fy += Math.cos(me.a); }
      if (keys.KeyA || keys.ArrowLeft) { fx -= -Math.sin(me.a); fy -= Math.cos(me.a); }
      const length = Math.hypot(fx, fy);
      if (length > 0) {
        fx /= length; fy /= length;
        const nx = me.x + fx * MOVE_SPEED * dt;
        const ny = me.y + fy * MOVE_SPEED * dt;
        if (!blocked(nx, me.y)) me.x = nx;
        if (!blocked(me.x, ny)) me.y = ny;
      }
    }

    if (!me.alive && world.phase === "playing" && now() >= me.respawnAt) spawnMe();

    if (world.phase === "playing" || world.phase === "waiting") {
      world.sendAcc += dt;
      if (world.sendAcc >= 1 / SEND_HZ) {
        world.sendAcc = 0;
        sendState();
      }
    }

    updateRemotes();
    updateHud();
  }

  function updateRemotes() {
    const renderTime = now() - INTERP_DELAY;
    for (const id in world.remotes) {
      const remote = world.remotes[id];
      const samples = remote.samples;
      if (!samples.length) {
        if (remote.x === 0 && remote.y === 0) {
          const me = world.me;
          remote.x = me.x; remote.y = me.y; remote.a = me.a;
        }
        continue;
      }
      let a = samples[samples.length - 1];
      let b = a;
      for (let i = 0; i < samples.length - 1; i++) {
        if (samples[i].time <= renderTime && renderTime <= samples[i + 1].time) {
          a = samples[i]; b = samples[i + 1];
          break;
        }
      }
      const span = b.time - a.time;
      const t = span > 0 ? clamp((renderTime - a.time) / span, 0, 1) : 0;
      remote.x = a.x + (b.x - a.x) * t;
      remote.y = a.y + (b.y - a.y) * t;
      remote.a = a.a + angleDelta(a.a, b.a) * t;
      remote.alive = samples[samples.length - 1].hp > 0;
    }
  }

  function updateHud() {
    const me = world.me;
    els.hpFill.style.width = clamp(me.hp, 0, 100) + "%";
    els.hpText.textContent = String(Math.round(me.hp));
    els.myFrags.textContent = String(me.frags);
    els.oppFrags.textContent = String(me.deaths);
    els.oppName.textContent = world.oppName;
    const remote = world.oppId ? world.remotes[world.oppId] : null;
    els.oppHpFill.style.width = clamp(remote ? remote.hp : 100, 0, 100) + "%";

    let remaining = MATCH_SECONDS;
    if (world.phase === "playing") remaining = Math.max(0, MATCH_SECONDS - (now() - world.matchStart) / 1000);
    const minutes = Math.floor(remaining / 60);
    const seconds = Math.floor(remaining % 60);
    els.timer.textContent = minutes + ":" + String(seconds).padStart(2, "0");
    els.timer.classList.toggle("low", remaining <= 30);

    if (world.phase === "playing" && !me.alive) {
      els.lockHint.hidden = false;
      els.lockHint.textContent = "Respawning in " + Math.max(0, (me.respawnAt - now()) / 1000).toFixed(1) + "s";
    } else if (world.phase === "playing") {
      els.lockHint.hidden = world.locked;
      els.lockHint.textContent = "Click to look · Esc to release";
    } else {
      els.lockHint.hidden = true;
    }
    els.crosshair.classList.toggle("hit", me.hitmarker > 0);
    els.hitmarker.hidden = me.hitmarker <= 0;
  }

  function hideHud() {
    els.hud.hidden = true;
    els.crosshair.hidden = true;
    els.lockHint.hidden = true;
    els.hitmarker.hidden = true;
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  let zBuffer = [];

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(320, Math.floor(canvas.clientWidth * dpr));
    const height = Math.max(200, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      zBuffer = new Array(Math.ceil(width / 2) + 2);
    }
    backdrop = null;
  }

  function wallColor(shade, band) {
    const value = clamp(Math.round(shade * band * 170), 0, 255);
    const r = Math.round(value * 1.0);
    const g = Math.round(value * 0.78);
    const b = Math.round(value * 0.6);
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  function paintBackground(W, H, horizon) {
    if (!backdrop || backdrop.width !== W || backdrop.height !== H) {
      backdrop = document.createElement("canvas");
      backdrop.width = W;
      backdrop.height = H;
      const bctx = backdrop.getContext("2d");
      const ceiling = bctx.createLinearGradient(0, 0, 0, H);
      ceiling.addColorStop(0, "#070b16");
      ceiling.addColorStop(Math.max(0, horizon / H), "#141d31");
      ceiling.addColorStop(1, "#070808");
      bctx.fillStyle = ceiling;
      bctx.fillRect(0, 0, W, H);
    }
    ctx.drawImage(backdrop, 0, 0);
  }

  function projectPoint(px, py, dirX, dirY, planeX, planeY, invDet, W) {
    const dx = px - world.me.x;
    const dy = py - world.me.y;
    const tx = invDet * (dirY * dx - dirX * dy);
    const ty = invDet * (-planeY * dx + planeX * dy);
    if (ty <= 0.12) return null;
    return { depth: ty, screenX: (W / 2) * (1 + tx / ty), lineHeight: (canvas.height / ty) };
  }

  function drawDecals(dirX, dirY, planeX, planeY, invDet, W, horizon) {
    for (const decal of world.decals) {
      const point = projectPoint(decal.x, decal.y, dirX, dirY, planeX, planeY, invDet, W);
      if (!point) continue;
      const col = clamp(Math.floor(point.screenX / 2), 0, zBuffer.length - 1);
      if (point.depth >= zBuffer[col] + 0.05) continue;
      const radius = clamp(point.lineHeight * 0.035, 1.2, 7);
      ctx.beginPath();
      ctx.arc(point.screenX, horizon, radius, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(15, 12, 10, 0.85)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(point.screenX, horizon, radius * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 190, 90, 0.5)";
      ctx.fill();
    }
  }

  function drawRemotes(dirX, dirY, planeX, planeY, invDet, W, horizon) {
    const list = Object.keys(world.remotes)
      .map((id) => world.remotes[id])
      .filter((remote) => remote.alive)
      .map((remote) => {
        const point = projectPoint(remote.x, remote.y, dirX, dirY, planeX, planeY, invDet, W);
        return point ? { remote, point } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.point.depth - a.point.depth);

    for (const { remote, point } of list) {
      const bodyH = point.lineHeight * 0.82;
      const bodyW = Math.max(3, point.lineHeight * 0.42);
      const bottom = horizon + point.lineHeight * 0.5;
      const top = bottom - bodyH;
      const x0 = Math.floor(point.screenX - bodyW / 2);
      const x1 = Math.ceil(point.screenX + bodyW / 2);
      const shade = clamp(1 - point.depth / 22, 0.4, 1);
      const body = "rgb(" + Math.round(200 * shade) + "," + Math.round(80 * shade) + "," + Math.round(80 * shade) + ")";
      for (let x = x0; x < x1; x += 2) {
        if (x < 0 || x >= W) continue;
        const col = clamp(Math.floor(x / 2), 0, zBuffer.length - 1);
        if (point.depth >= zBuffer[col]) continue;
        ctx.fillStyle = body;
        ctx.fillRect(x, top, 2, bodyH);
      }
      const centerCol = clamp(Math.floor(point.screenX / 2), 0, zBuffer.length - 1);
      if (point.depth >= zBuffer[centerCol]) continue;

      // Head.
      ctx.beginPath();
      ctx.arc(point.screenX, top + bodyH * 0.12, bodyW * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = "rgb(" + Math.round(240 * shade) + "," + Math.round(180 * shade) + "," + Math.round(150 * shade) + ")";
      ctx.fill();

      // Name + health.
      const fontSize = clamp(point.lineHeight * 0.13, 10, 18);
      ctx.font = "bold " + Math.round(fontSize) + "px monospace";
      ctx.textAlign = "center";
      const label = remote.name;
      const textWidth = ctx.measureText(label).width;
      const barY = top - fontSize - 12;
      ctx.fillStyle = "rgba(4, 8, 15, 0.7)";
      ctx.fillRect(point.screenX - textWidth / 2 - 5, barY - 2, textWidth + 10, fontSize + 8);
      ctx.fillStyle = "#f1f5ff";
      ctx.fillText(label, point.screenX, barY + fontSize);
      const barWidth = Math.max(26, bodyW);
      const hp = clamp(remote.hp, 0, 100) / 100;
      ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
      ctx.fillRect(point.screenX - barWidth / 2, barY - 8, barWidth, 3);
      ctx.fillStyle = hp > 0.35 ? "#4ade80" : "#f87171";
      ctx.fillRect(point.screenX - barWidth / 2, barY - 8, barWidth * hp, 3);
    }
  }

  function drawWeapon(W, H) {
    const me = world.me;
    const baseY = H - 6;
    const bob = world.phase === "playing" && me.alive
      ? Math.sin(now() / 240) * (world.keys.KeyW || world.keys.KeyS ? 4 : 1.5)
      : 0;
    const gunW = Math.max(70, W * 0.13);
    const x = W * 0.5 + W * 0.06;
    ctx.save();
    ctx.translate(x, baseY + bob);
    ctx.fillStyle = "#1b2333";
    ctx.beginPath();
    ctx.moveTo(-gunW * 0.18, 0);
    ctx.lineTo(-gunW * 0.1, -H * 0.22);
    ctx.lineTo(gunW * 0.06, -H * 0.24);
    ctx.lineTo(gunW * 0.16, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#2b3650";
    ctx.fillRect(-gunW * 0.06, -H * 0.27, gunW * 0.12, H * 0.05);
    if (me.muzzle > 0) {
      ctx.beginPath();
      ctx.arc(gunW * 0.0, -H * 0.28, Math.max(10, W * 0.02), 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 220, 120, 0.95)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(gunW * 0.0, -H * 0.28, Math.max(20, W * 0.04), 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 150, 40, 0.25)";
      ctx.fill();
    }
    ctx.restore();
  }

  function render() {
    if (!canvas.width || !canvas.height) return;
    const W = canvas.width;
    const H = canvas.height;
    const me = world.me;
    const horizon = Math.round(H * 0.5 + world.pitch);
    const dirX = Math.cos(me.a);
    const dirY = Math.sin(me.a);
    const tan = Math.tan(FOV / 2);
    const planeX = -dirY * tan;
    const planeY = dirX * tan;
    const invDet = 1 / (planeX * dirY - dirX * planeY || 1e-9);

    paintBackground(W, H, horizon);

    const step = 2;
    for (let x = 0; x < W; x += step) {
      const cameraX = (2 * x) / W - 1;
      const rayX = dirX + planeX * cameraX;
      const rayY = dirY + planeY * cameraX;
      const hit = castRay(me.x, me.y, rayX, rayY);
      const lineHeight = H / hit.dist;
      const top = horizon - lineHeight / 2;
      const height = lineHeight;
      const band = (hit.mapX + hit.mapY) % 2 === 0 ? 1.0 : 0.86;
      const shade = clamp(1 - hit.dist / 20, 0.18, 1) * (hit.side === 1 ? 0.74 : 1);
      ctx.fillStyle = wallColor(shade, band);
      ctx.fillRect(x, top, step, Math.max(1, height));
      zBuffer[Math.floor(x / step)] = hit.dist;
    }

    drawDecals(dirX, dirY, planeX, planeY, invDet, W, horizon);
    drawRemotes(dirX, dirY, planeX, planeY, invDet, W, horizon);
    drawWeapon(W, H);
  }

  // ── Main loop ─────────────────────────────────────────────────────────────
  let lastFrame = now();
  function frame() {
    const time = now();
    const dt = Math.min(0.05, (time - lastFrame) / 1000);
    lastFrame = time;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ── Input ─────────────────────────────────────────────────────────────────
  function requestLock() {
    if (document.pointerLockElement === canvas) return;
    try {
      const result = canvas.requestPointerLock();
      if (result && typeof result.catch === "function") result.catch(() => {});
    } catch (error) { /* unsupported */ }
  }

  canvas.addEventListener("mousedown", (event) => {
    if (world.phase !== "playing") return;
    if (document.pointerLockElement !== canvas) { requestLock(); return; }
    if (event.button === 0) fireOnce();
  });

  document.addEventListener("pointerlockchange", () => {
    world.locked = document.pointerLockElement === canvas;
    if (world.locked) els.lockHint.hidden = true;
  });

  document.addEventListener("mousemove", (event) => {
    if (!world.locked || world.phase !== "playing") return;
    world.me.a += event.movementX * MOUSE_SENS;
    world.pitch = clamp(world.pitch - event.movementY * MOUSE_SENS * 320, -canvas.height * 0.22, canvas.height * 0.22);
  });

  document.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
      event.preventDefault();
      if (world.phase === "playing" && world.locked) fireOnce();
      return;
    }
    world.keys[event.code] = true;
  });
  document.addEventListener("keyup", (event) => { world.keys[event.code] = false; });

  window.addEventListener("blur", () => { world.keys = Object.create(null); });

  els.overlayBtn.addEventListener("click", () => {
    if (world.phase === "finding" || world.phase === "waiting") { closeChannel(); world.phase = "menu"; }
    startOnline();
  });

  // ── Debug surface (used by the automated two-context smoke test) ──────────
  window.ArenaFPS = {
    get phase() { return world.phase; },
    get roster() { return world.roster.slice(); },
    state() {
      const remote = world.oppId ? world.remotes[world.oppId] : null;
      return {
        phase: world.phase,
        roster: world.roster.slice(),
        myId: world.myId,
        oppId: world.oppId,
        oppName: world.oppName,
        my: { x: world.me.x, y: world.me.y, a: world.me.a, hp: world.me.hp, alive: world.me.alive, frags: world.me.frags, deaths: world.me.deaths },
        opponent: remote ? { id: remote.id, name: remote.name, x: remote.x, y: remote.y, hp: remote.hp, alive: remote.alive, samples: remote.samples.length } : null,
        channelConnected: Boolean(world.channel && world.channel.connected),
      };
    },
    startOnline,
    setPos(x, y, a) {
      world.me.x = Number(x);
      world.me.y = Number(y);
      if (typeof a === "number") world.me.a = a;
      sendState();
    },
    lookAt(x, y) {
      world.me.a = Math.atan2(Number(y) - world.me.y, Number(x) - world.me.x);
    },
    setHp(hp) {
      world.me.hp = clamp(Number(hp), 0, 100);
      if (world.me.hp <= 0) applyDamage(0);
    },
    fire() {
      world.me.fireCooldown = 0;
      fireOnce();
    },
    forceDamage(dmg) { applyDamage(Number(dmg) || 0); },
  };

  // ── Boot ──────────────────────────────────────────────────────────────────
  resize();
  new ResizeObserver(resize).observe(canvas);
  window.addEventListener("resize", resize);
  requestAnimationFrame(frame);

  setOverlay(
    "Arena FPS",
    "Real-time first-person deathmatch against another player. First to 10 frags — or the highest frag count in 3 minutes — wins.",
    { button: "Find match", status: "", logo: true }
  );

  Gamebase.ready()
    .then((player) => {
      world.myHandle = player.handle;
      els.connectHint.textContent = "Playing as " + player.handle;
    })
    .catch((error) => {
      els.connectHint.textContent = "Offline — matchmaking unavailable.";
      console.warn("[arena-fps] Gamebase unavailable", error);
    });
})();
