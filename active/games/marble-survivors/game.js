// ──────────────────────────────────────────────
// Blood Marble — Gyro Survivors (v2)
// Expanded world · Error reporter · Fixed gyro
// ──────────────────────────────────────────────

// ─── Error Reporter (inline, vroomon-style) ──
(function() {
  const ERRORS = [];
  const COLORS = { Error:'#ff6b4a', TypeError:'#ff6b4a', ReferenceError:'#ff6b4a',
    SyntaxError:'#ffd166', UnhandledRejection:'#ff6b4a', console:'#97abc7' };
  const origError = console.error.bind(console);
  const origWarn  = console.warn.bind(console);
  console.error = (...args) => { capture('console', ...args); origError(...args); };
  console.warn  = (...args) => { capture('warn', ...args); origWarn(...args); };
  window.addEventListener('error', e => {
    const err = e.error || { message: e.message || 'unknown', stack: '' };
    addReport({ id:makeId(), message:err.message||String(err), stack:err.stack,
      type:err.name||'Error', time:Date.now(), source:'unhandled' });
  });
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason;
    addReport({ id:makeId(), message:r?.message||String(r||'Promise rejection'),
      stack:r?.stack, type:r?.name||'UnhandledRejection', time:Date.now(), source:'promise' });
  });
  function capture(level, ...args) {
    const msg = args.map(a => typeof a==='string'?a:tryJSON(a)).join(' ');
    if (!msg.trim()) return;
    addReport({ id:makeId(), message:`[${level}] ${msg}`, type:level==='warn'?'warn':'console',
      time:Date.now(), source:'console' });
  }
  function addReport(r) { ERRORS.push(r); if(ERRORS.length>50)ERRORS.shift(); renderErrors(); }
  function tryJSON(v) { try{return JSON.stringify(v)}catch{return String(v)} }
  function makeId() { return Date.now().toString(36)+Math.random().toString(36).slice(2,6) }

  function renderErrors() {
    const panel = document.getElementById('error-panel-list');
    const badge = document.getElementById('error-badge');
    if (!panel) return;
    panel.innerHTML = ERRORS.slice(-10).reverse().map(r => {
      const c = COLORS[r.type]||'#97abc7';
      const s = r.stack ? r.stack.split('\n').slice(0,2).join('\n') : '';
      return `<div class="err-entry" style="border-left:3px solid ${c}">
        <div class="err-head"><span style="color:${c}">${esc(r.type)}</span><span class="err-time">${new Date(r.time).toLocaleTimeString()}</span></div>
        <div class="err-msg">${esc(r.message)}</div>${s?`<pre class="err-stack">${esc(s)}</pre>`:''}</div>`;
    }).join('');
    if (badge) { badge.textContent = ERRORS.length; badge.dataset.active = ERRORS.length > 0 ? 'true' : 'false'; }
  }
  function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  window.__errorCount = () => ERRORS.length;
  window.__errorClear = () => { ERRORS.length = 0; renderErrors(); };
  // Expose for manual logging
  window.__logError = (msg, ctx) => addReport({ id:makeId(), message:msg, type:'manual', time:Date.now(), source:'manual', context:ctx });
})();

// ─── Constants ────────────────────────────────
const PI = Math.PI;
const TAU = PI * 2;

// Expanded world
const WORLD_W = 3000;
const WORLD_H = 3000;
const GRID_SIZE = 60;
const PARTICLE_CAP = 600;
const TRAIL_MAX = 8;

// Decorations (placed at startup)
const DECO_TYPES = [
  { name:'tombstone', color:'#4a4a5a', glow:'#2a2a3a', radius:8 },
  { name:'tree',      color:'#1a3a2a', glow:'#0a2a1a', radius:12 },
  { name:'ruin',      color:'#3a3a4a', glow:'#2a2a3a', radius:14 },
  { name:'puddle',    color:'#1a2a3a', glow:'#0a1a2a', radius:18 },
  { name:'bloodpool', color:'#3a0a0a', glow:'#2a0000', radius:10 },
  { name:'crystal',   color:'#4a3a6a', glow:'#3a2a5a', radius:6 },
];

const UPGRADES = [
  { id:'speed',      name:'Move Speed',   icon:'🔥', desc:'+15% move speed',        maxLevel:10, base:0.15 },
  { id:'maxHp',      name:'Max HP',        icon:'❤️', desc:'+20 max HP',              maxLevel:10, base:20 },
  { id:'damage',     name:'Damage',        icon:'⚔️', desc:'+25% projectile damage',  maxLevel:10, base:0.25 },
  { id:'attackSpeed',name:'Attack Speed',  icon:'🏹', desc:'+20% attack speed',       maxLevel:10, base:0.20 },
  { id:'range',      name:'Range',         icon:'🎯', desc:'+20% attack range',       maxLevel:10, base:0.20 },
  { id:'regen',      name:'HP Regen',      icon:'💚', desc:'+0.5 HP/sec',             maxLevel:10, base:0.5 },
  { id:'multishot',  name:'Multi-shot',    icon:'🌀', desc:'+1 projectile per shot',  maxLevel:5,  base:1 },
  { id:'magnetism',  name:'Gate Reach',    icon:'🧲', desc:'+30% gate capture radius', maxLevel:5,  base:0.30 },
  { id:'orbValue',   name:'Gate Value',    icon:'💎', desc:'+25% XP per gate',         maxLevel:5,  base:0.25 },
  { id:'shield',     name:'Shield',        icon:'🛡️', desc:'Block hits — +1 charge (8s cd)', maxLevel:5, base:1 },
  { id:'freezeAura', name:'Freeze Aura',   icon:'❄️', desc:'Slow enemies 20% in range',      maxLevel:5, base:0.20 },
  { id:'fireAura',   name:'Fire Aura',     icon:'🔥', desc:'Burn enemies for 5 DPS in range', maxLevel:5, base:5 },
  { id:'piercing',   name:'Piercing',      icon:'⚡', desc:'Projectiles pierce +1 enemy',      maxLevel:3, base:1 },
  { id:'homing',     name:'Homing',        icon:'🔄', desc:'Projectiles track enemies',         maxLevel:3, base:0.5 },
  { id:'explosive',  name:'Explosive',     icon:'💥', desc:'Projectiles explode (area damage)', maxLevel:3, base:30 },
  { id:'vampiric',   name:'Vampiric',      icon:'🧛', desc:'Heal 1 HP per kill',               maxLevel:5, base:1 },
  { id:'chain',      name:'Chain',         icon:'⚡', desc:'Projectiles chain to +1 enemy',     maxLevel:3, base:1 },
  { id:'thorns',     name:'Thorns',        icon:'🗡️', desc:'Reflect 15% contact damage',       maxLevel:5, base:0.15 },
];

const ENEMY_TYPES = {
  bat:       { name:'Bat',       r:8,  hp:8,   spd:120, dmg:5,  xp:3,   c:'#8b5cf6', g:'#6d28d9', beh:null },
  zombie:    { name:'Zombie',    r:14, hp:20,  spd:50,  dmg:10, xp:5,   c:'#65a30d', g:'#4d7c0f', beh:null },
  skeleton:  { name:'Skeleton',  r:12, hp:15,  spd:70,  dmg:8,  xp:4,   c:'#e2e8f0', g:'#94a3b8', beh:null },
  vampire:   { name:'Vampire',   r:16, hp:35,  spd:85,  dmg:15, xp:8,   c:'#dc2626', g:'#991b1b', beh:null },
  elite:     { name:'Elite',     r:20, hp:80,  spd:60,  dmg:20, xp:20,  c:'#f59e0b', g:'#d97706', beh:null },
  ghost:     { name:'Ghost',     r:12, hp:12,  spd:80,  dmg:8,  xp:6,   c:'#c4b5fd', g:'#8b5cf6', beh:'phase' },
  witch:     { name:'Witch',     r:14, hp:18,  spd:55,  dmg:6,  xp:8,   c:'#34d399', g:'#059669', beh:'ranged' },
  werewolf:  { name:'Werewolf',  r:16, hp:30,  spd:65,  dmg:12, xp:10,  c:'#a16207', g:'#713f12', beh:'berserk' },
  hellhound: { name:'Hellhound', r:10, hp:10,  spd:110, dmg:7,  xp:5,   c:'#fb923c', g:'#ea580c', beh:'fireTrail' },
  necro:     { name:'Necromancer',r:16, hp:25,  spd:45,  dmg:5,  xp:12,  c:'#a78bfa', g:'#7c3aed', beh:'summon' },
  golem:     { name:'Blood Golem',r:22, hp:60,  spd:35,  dmg:18, xp:15,  c:'#be123c', g:'#881337', beh:'split' },
  boss:      { name:'Blood Lord',r:32, hp:300, spd:40,  dmg:30, xp:100, c:'#ef4444', g:'#7f1d1d', beh:'boss' },
};

function availableEnemies(wave) {
  const t = ['bat'];
  if(wave>=2) t.push('zombie'); if(wave>=3) t.push('skeleton');
  if(wave>=4) t.push('ghost'); if(wave>=5) t.push('vampire');
  if(wave>=6) t.push('witch'); if(wave>=7) t.push('werewolf');
  if(wave>=8) t.push('hellhound'); if(wave>=9) t.push('necro');
  if(wave>=10) t.push('golem','elite');
  return t;
}

// ─── Utilities ──────────────────────────────
const rng     = (a,b) => a + Math.random()*(b-a);
const randInt = (a,b) => Math.floor(rng(a,b+1));
const dist    = (a,b) => Math.hypot(a.x-b.x, a.y-b.y);
const lerp    = (a,b,t) => a + (b-a)*t;
const clamp   = (v,lo,hi) => Math.max(lo, Math.min(hi, v));
const choose  = a => a[Math.floor(Math.random()*a.length)];

// Safe clamp that guards against NaN
function safeClamp(v,lo,hi) {
  if (isNaN(v) || !isFinite(v)) return (lo+hi)/2;
  return Math.max(lo, Math.min(hi, v));
}

// ─── Audio ──────────────────────────────────
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
function initAudio() { if(!audioCtx) audioCtx=new AudioCtx(); }
function sfx(type) {
  try {
    initAudio(); const t=audioCtx.currentTime;
    const osc=(freq,type='sine')=>{const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.connect(g);g.connect(audioCtx.destination);o.type=type;return{o,g}};
    const play=(o,g,freq,endFreq,dur,vol=0.08)=>{
      o.frequency.setValueAtTime(freq,t); if(endFreq) o.frequency.exponentialRampToValueAtTime(endFreq,t+dur);
      g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(0.001,t+dur);
      o.start(t); o.stop(t+dur);
    };
    if(type==='hit'){const{o,g}=osc(220,'sawtooth');play(o,g,220,440,0.15);}
    else if(type==='xp'){const{o,g}=osc(523);play(o,g,523,784,0.15,0.06);}
    else if(type==='levelup'){[523,659,784,1047].forEach((f,i)=>{const{o,g}=osc(f);play(o,g,f,null,0.15,0.08);o.start(t+i*0.1);o.stop(t+i*0.1+0.15);});}
    else if(type==='damage'){const{o,g}=osc(80,'square');play(o,g,80,40,0.2);}
    else if(type==='explode'){const{o,g}=osc(100,'sawtooth');play(o,g,100,30,0.3,0.12);}
    else if(type==='gameover'){[400,350,300,200].forEach((f,i)=>{const{o,g}=osc(f,'sawtooth');play(o,g,f,null,0.3,0.06);o.start(t+i*0.2);o.stop(t+i*0.2+0.3);});}
    else if(type==='summon'){const{o,g}=osc(300);play(o,g,300,600,0.15,0.05);}
    else if(type==='heal'){const{o,g}=osc(600);play(o,g,600,900,0.12,0.05);}
  } catch(e) {}
}

// ─── Main State ─────────────────────────────
const G = {
  player:null, enemies:[], projectiles:[], xpOrbs:[], gates:[],
  particles:[], floatingTexts:[], damageNumbers:[],
  fireTrails:[], enemyProjectiles:[], decorations:[],
  wave:0, waveState:'idle', waveTimer:1.5, waveBreakDuration:3,
  enemiesThisWave:0, enemiesSpawned:0,
  spawnTimer:0, spawnInterval:0.5,
  xp:0, xpToNext:10, level:1, score:0, survivalTime:0, enemiesTotalKilled:0,
  upgradeLevels:{}, upgradeChoices:[], showingUpgrades:false,
  pendingLevelUps:0, // queued level-ups while upgrade panel is open
  gameOver:false, paused:false,
  input:{x:0,y:0,targetX:0,targetY:0},
  gyroActive:false, gyroSupported:false, isMobile:false, keys:{},
  gyroTimeout:null, // fallback: disable gyro if no events fire
  gyroEventsReceived:0, // count of real gyro events received
  gyroLastTime:-999, // survivalTime of last gyro event
  canvas:null, ctx:null, W:0, H:0,
  cam:{x:0,y:0},
  shakeX:0, shakeY:0, shakeIntensity:0,
  damageWindow:[], dps:0,
  started:false, // false until first user gesture (for audio)
};

function resetGame() {
  G.player = {
    x:WORLD_W/2, y:WORLD_H/2, radius:16,
    hp:100, maxHp:100, speed:200, damage:15, attackSpeed:1.0, attackRange:300,
    attackCooldown:0, regen:0, multishot:1, magnetism:300, orbValue:1,
    invincible:0, facing:0, velX:0, velY:0,
    // Super Monkey Ball–style momentum physics
    accel:4.0,        // how fast the ball reaches target velocity (per second)
    friction:0.12,    // velocity retained per second when coasting (lower = slides more)
    rollAngle:0, // accumulated rolling rotation (for texture)
    rollAxis:0, // current rolling axis angle (perpendicular to velocity)
    shieldCharges:0, shieldMaxCharges:0, shieldCooldown:0,
    freezeAura:0, fireAura:0, piercing:0, homing:0, explosive:0,
    vampiric:0, chain:0, thorns:0, fireTimer:0,
  };
  G.cam.x = G.player.x; G.cam.y = G.player.y;
  G.enemies=[]; G.projectiles=[]; G.xpOrbs=[]; G.gates=[]; G.particles=[]; G.floatingTexts=[];
  G.damageNumbers=[]; G.fireTrails=[]; G.enemyProjectiles=[];
  G.wave=0; G.waveState='idle'; G.waveTimer=1.5; G.enemiesThisWave=0; G.enemiesSpawned=0;
  G.spawnTimer=0; G.spawnInterval=0.5;
  G.xp=0; G.xpToNext=10; G.level=1; G.score=0; G.survivalTime=0; G.enemiesTotalKilled=0;
  G.upgradeLevels={}; G.upgradeChoices=[]; G.showingUpgrades=false;
  G.pendingLevelUps=0;
  G.gameOver=false; G.paused=false;
  G.input={x:0,y:0,targetX:0,targetY:0};
  G.gyroEventsReceived=0; G.gyroLastTime=-999;
  G.shakeIntensity=0; G.shakeX=0; G.shakeY=0; G.damageWindow=[]; G.dps=0;
  generateDecorations();
  generateGates();
}

// ─── Decorations ────────────────────────────
function generateDecorations() {
  G.decorations = [];
  const count = 120;
  for (let i = 0; i < count; i++) {
    const type = choose(DECO_TYPES);
    let x, y, ok;
    for (let attempt = 0; attempt < 20; attempt++) {
      x = rng(100, WORLD_W-100); y = rng(100, WORLD_H-100);
      ok = true;
      // Don't place too close to center spawn
      if (Math.hypot(x-WORLD_W/2, y-WORLD_H/2) < 200) { ok=false; continue; }
      // Don't overlap other decorations
      for (const d of G.decorations) {
        if (Math.hypot(x-d.x, y-d.y) < 40) { ok=false; break; }
      }
      if (ok) break;
    }
    if (ok) {
      G.decorations.push({
        x, y, type:type.name, color:type.color, glow:type.glow, radius:type.radius,
        angle: rng(0,TAU), scale: rng(0.7, 1.3),
      });
    }
  }
}

// ─── Gates (XP source) ────────────────────
// Gates are glowing rings the marble passes through to gain XP.
// Killing enemies no longer grants XP — gates are the sole source.
const GATE_TARGET_COUNT = 7;

function gateValue() {
  // XP per gate scales with the current wave so later gates matter more.
  return Math.max(3, Math.ceil(3 + G.wave * 1.5));
}

function gateColor(value) {
  // Low-value gates are emerald; high-value gates shift to gold then violet.
  if (value >= 12) return { color:'#c084fc', glow:'#7c3aed' };
  if (value >= 7)  return { color:'#fbbf24', glow:'#f59e0b' };
  return { color:'#34d399', glow:'#10b981' };
}

function spawnGate(avoid) {
  const p = G.player;
  let x, y, ok;
  for (let attempt = 0; attempt < 30; attempt++) {
    x = rng(120, WORLD_W-120); y = rng(120, WORLD_H-120);
    ok = true;
    // Don't spawn right on top of the player
    if (p && Math.hypot(x-p.x, y-p.y) < 250) { ok=false; continue; }
    // Don't overlap other gates
    for (const g of G.gates) {
      if (Math.hypot(x-g.x, y-g.y) < 220) { ok=false; break; }
    }
    if (ok) break;
  }
  const value = gateValue();
  const { color, glow } = gateColor(value);
  G.gates.push({
    x, y, radius:34, value, color, glow,
    pulse: rng(0, TAU), spin: rng(0, TAU), born: G.survivalTime,
  });
}

function generateGates() {
  G.gates = [];
  for (let i = 0; i < GATE_TARGET_COUNT; i++) spawnGate();
}

function updateGates(dt) {
  const p = G.player; if (!p) return;
  for (let i = G.gates.length-1; i >= 0; i--) {
    const g = G.gates[i];
    g.pulse += dt * 2.5;
    g.spin  += dt * 1.2;
    // Capture radius: the ring itself plus a reach bonus from the
    // repurposed "Gate Reach" (magnetism) upgrade.
    const reach = g.radius + p.magnetism * 0.1;
    if (dist(g, p) < reach) {
      const val = Math.round(g.value * p.orbValue);
      G.xp += val;
      sfx('xp');
      showFloatingText(p.x, p.y-30, `+${val} XP`,'#a78bfa',0.7);
      // Burst of particles in the gate's color
      for (let k=0;k<18;k++) {
        const a=rng(0,TAU), spd=rng(60,200);
        addParticle(g.x,g.y,Math.cos(a)*spd,Math.sin(a)*spd,g.color,g.glow,0.4,0.6,rng(2,4));
      }
      while (G.xp >= G.xpToNext) { G.xp -= G.xpToNext; levelUp(); }
      // Remove and respawn a new gate elsewhere
      G.gates.splice(i,1);
      spawnGate();
    }
  }
  // Keep the gate population topped up (e.g. after a wave change)
  while (G.gates.length < GATE_TARGET_COUNT) spawnGate();
}

// ─── Input (fixed gyro) ─────────────────────
function detectMobile() {
  return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini|Mobile|mobile/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1);
}

function setupInput() {
  const canvas = G.canvas;
  G.isMobile = detectMobile();
  G.gyroSupported = 'DeviceOrientationEvent' in window;

  // Auto-enable gyro on mobile. We keep it "active" (preferred) and let
  // getInput fall back to touch when no events arrive (e.g. non-HTTPS on
  // Android, where DeviceOrientation silently never fires). This way the
  // player is never stuck — touch always works as a fallback.
  if (G.gyroSupported && G.isMobile) {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      // iOS 13+ — needs a user-gesture tap. Show the prompt.
      const prompt = document.getElementById('gyro-prompt');
      if (prompt) prompt.style.display = 'block';
    } else {
      // Android / older iOS — register the listener immediately.
      G.gyroActive = true;
      window.addEventListener('deviceorientation', onGyro);
    }
  }
  // Desktop: gyro starts disabled. User can toggle on if they have a sensor.

  // Mouse
  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const sx = G.W / rect.width, sy = G.H / rect.height;
    const screenX = (e.clientX - rect.left) * sx;
    const screenY = (e.clientY - rect.top) * sy;
    G.input.targetX = screenX - G.W/2;
    G.input.targetY = screenY - G.H/2;
  });
  canvas.addEventListener('mouseleave', () => { G.input.targetX=0; G.input.targetY=0; });

  // Touch — always record target so getInput's touch fallback works even when
  // gyro is "active" but not actually firing events.
  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = G.W / rect.width, sy = G.H / rect.height;
    const t = e.touches[0];
    G.input.targetX = ((t.clientX - rect.left) * sx) - G.W/2;
    G.input.targetY = ((t.clientY - rect.top) * sy) - G.H/2;
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = G.W / rect.width, sy = G.H / rect.height;
    const t = e.touches[0];
    G.input.targetX = ((t.clientX - rect.left) * sx) - G.W/2;
    G.input.targetY = ((t.clientY - rect.top) * sy) - G.H/2;
  }, { passive: false });
  canvas.addEventListener('touchend', e => { G.input.targetX=0; G.input.targetY=0; });

  // Keyboard
  document.addEventListener('keydown', e => {
    // Pause toggle
    if (e.key === 'p' || e.key === 'P' || e.key === ' ') {
      if (!G.gameOver && !G.showingUpgrades) G.paused = !G.paused;
      e.preventDefault();
    }
    G.keys[e.key] = true;
  });
  document.addEventListener('keyup', e => { G.keys[e.key] = false; });

  // Resume audio context on first user gesture (browser autoplay policy)
  const resumeAudio = () => {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    G.started = true;
    document.removeEventListener('click', resumeAudio);
    document.removeEventListener('touchstart', resumeAudio);
    document.removeEventListener('keydown', resumeAudio);
  };
  document.addEventListener('click', resumeAudio);
  document.addEventListener('touchstart', resumeAudio);
  document.addEventListener('keydown', resumeAudio);

  // Gyro permission (iOS)
  const enableBtn = document.getElementById('enable-gyro');
  if (enableBtn) {
    enableBtn.addEventListener('click', async () => {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
          const r = await DeviceOrientationEvent.requestPermission();
          if (r === 'granted') {
            window.addEventListener('deviceorientation', onGyro);
            G.gyroActive = true;
            const p = document.getElementById('gyro-prompt');
            if (p) p.style.display = 'none';
            const tb = document.getElementById('toggle-gyro');
            if (tb) tb.textContent = '🎯 Gyro';
          }
        } catch(e) { console.warn('Gyro permission error:', e); }
      }
    });
  }

  // Toggle button
  const toggleBtn = document.getElementById('toggle-gyro');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      G.gyroActive = !G.gyroActive;
      toggleBtn.textContent = G.gyroActive ? '🎯 Gyro' : '🖱️ Mouse';
      if (G.gyroActive && G.gyroSupported) {
        window.addEventListener('deviceorientation', onGyro);
      } else {
        window.removeEventListener('deviceorientation', onGyro);
      }
    });
    toggleBtn.textContent = G.gyroActive ? '🎯 Gyro' : '🖱️ Mouse';
  }
}

function onGyro(event) {
  const gamma = event.gamma;
  const beta  = event.beta;
  // Guard: some environments fire deviceorientation with null values
  if (gamma == null || beta == null || isNaN(gamma) || isNaN(beta)) return;
  G.gyroEventsReceived++;
  G.gyroLastTime = G.survivalTime;
  // Deadzone: holding the phone roughly flat (~±12°) produces no movement,
  // so the marble doesn't drift when the player isn't intentionally tilting.
  const DZ = 12;
  let gx = gamma, gy = beta;
  if (Math.abs(gx) < DZ) gx = 0; else gx = gx - Math.sign(gx) * DZ;
  if (Math.abs(gy) < DZ) gy = 0; else gy = gy - Math.sign(gy) * DZ;
  // Map the remaining tilt (up to ~60°) to a -1..1 direction.
  G.input.x = clamp(gx / 60, -1, 1);
  G.input.y = clamp(gy / 60, -1, 1);
}

function getInput(dt) {
  const p = G.player;
  if (!p) return { dx:0, dy:0 };
  let dx = 0, dy = 0;

  // Use gyro only if it's active AND we've received a recent event (within
  // 1s). If gyro never fires (e.g. non-HTTPS Android), silently fall through
  // to touch/keyboard so the player is never stuck.
  const gyroLive = G.gyroActive && G.gyroSupported &&
    G.gyroEventsReceived > 0 &&
    (G.survivalTime - G.gyroLastTime) < 1.0;

  if (gyroLive) {
    dx = G.input.x; dy = G.input.y;
  } else {
    // Keyboard
    if (G.keys) {
      if (G.keys['w']||G.keys['ArrowUp'])    dy -= 1;
      if (G.keys['s']||G.keys['ArrowDown'])  dy += 1;
      if (G.keys['a']||G.keys['ArrowLeft'])  dx -= 1;
      if (G.keys['d']||G.keys['ArrowRight']) dx += 1;
    }
    // Mouse/touch: offset from screen center
    const ox = G.input.targetX, oy = G.input.targetY;
    const deadzone = 20;
    if (Math.abs(ox) > deadzone || Math.abs(oy) > deadzone) {
      const len = Math.hypot(ox, oy);
      dx += (ox / len) * Math.min(1, len / 200);
      dy += (oy / len) * Math.min(1, len / 200);
    }
  }

  const len = Math.hypot(dx, dy);
  if (len > 1) { dx /= len; dy /= len; }
  return { dx: safeClamp(dx,-1,1), dy: safeClamp(dy,-1,1) };
}

// ─── Camera ─────────────────────────────────
function updateCamera(dt) {
  const p = G.player;
  if (!p) return;
  const targetX = p.x;
  const targetY = p.y;
  G.cam.x = lerp(G.cam.x, targetX, 5 * dt);
  G.cam.y = lerp(G.cam.y, targetY, 5 * dt);
  // Clamp camera so we don't show void beyond world edges
  const halfW = G.W/2;
  const halfH = G.H/2;
  G.cam.x = clamp(G.cam.x, halfW, WORLD_W - halfW);
  G.cam.y = clamp(G.cam.y, halfH, WORLD_H - halfH);
}

// ─── Entity factory ─────────────────────────
function makeEnemy(type, x, y) {
  const t = ENEMY_TYPES[type];
  const wm = 1 + (G.wave-1)*0.15;
  const sm = Math.min(2, 1 + (G.wave-1)*0.02);
  return {
    x, y, radius:t.r,
    hp:Math.round(t.hp*wm), maxHp:Math.round(t.hp*wm),
    speed:t.spd*sm, damage:t.dmg,
    xp:Math.round(t.xp*(1+(G.wave-1)*0.1)),
    color:t.c, glowColor:t.g, type, name:t.name, beh:t.beh,
    hitFlash:0, angle:0, attackCooldown:0,
    isBoss:type==='boss',
    behTimer:0, berserked:false, splitCount:0, summonCooldown:0, trailTimer:0,
    phaseAlpha:1, dead:false,
  };
}

// ─── Spawning ────────────────────────────────
function spawnEnemy() {
  const types = availableEnemies(G.wave);
  const w = types.map((_,i) => 1 + i*0.4);
  const tw = w.reduce((a,b)=>a+b,0);
  let r = Math.random()*tw, idx = 0;
  for (let i=0; i<w.length; i++) { r-=w[i]; if(r<=0){idx=i;break;} }

  // Spawn from edge of camera view, with margin beyond visible area
  const margin = 60;
  const chw = G.W/2, chh = G.H/2;
  // Spawn in a ring around camera, at least chw/chh away but within world bounds
  const spawnDist = Math.max(chw, chh) + margin + rng(0, 100);
  const angle2 = rng(0, TAU);
  let sx = G.cam.x + Math.cos(angle2) * spawnDist;
  let sy = G.cam.y + Math.sin(angle2) * spawnDist;
  sx = clamp(sx, 20, WORLD_W-20);
  sy = clamp(sy, 20, WORLD_H-20);

  G.enemies.push(makeEnemy(types[idx], sx, sy));
}

function spawnBoss() {
  const margin = 60;
  const chw = G.W/2, chh = G.H/2;
  const spawnDist = Math.max(chw, chh) + margin + 50;
  const angle2 = rng(0, TAU);
  let sx = G.cam.x + Math.cos(angle2) * spawnDist;
  let sy = G.cam.y + Math.sin(angle2) * spawnDist;
  sx = clamp(sx, 40, WORLD_W-40);
  sy = clamp(sy, 40, WORLD_H-40);

  const e = makeEnemy('boss', sx, sy);
  const wm = 1 + (G.wave-1)*0.12;
  e.hp = Math.round(e.maxHp * wm);
  e.maxHp = e.hp;
  G.enemies.push(e);

  for (let i=0; i<40; i++) {
    const a = Math.random()*TAU;
    const rr = rng(200,400);
    addParticle(sx+Math.cos(a)*rr, sy+Math.sin(a)*rr,
      Math.cos(a)*-250, Math.sin(a)*-250, '#ef4444', '#7f1d1d', 0.6, 1, 6);
  }
}

function startWave() {
  G.wave++;
  const isBoss = G.wave % 5 === 0;
  G.enemiesThisWave = isBoss ? 5+Math.floor(G.wave*1.5) : 5+Math.floor(G.wave*2.5);
  G.enemiesSpawned = 0;
  G.spawnTimer = 0;
  G.spawnInterval = Math.max(0.12, 0.6 - G.wave*0.02);
  G.waveState = 'active';
  if (isBoss) G.spawnInterval = 0.3;
  showFloatingText(G.cam.x,G.cam.y-G.H/4,
    isBoss ? `⚠ BOSS WAVE ${G.wave} ⚠` : `Wave ${G.wave}`,
    isBoss ? '#ef4444' : '#fbbf24', isBoss ? 2.5 : 1.5);
}

function updateWave(dt) {
  switch(G.waveState) {
    case 'idle':
      G.waveTimer -= dt;
      if (G.waveTimer <= 0) startWave();
      break;
    case 'active':
      G.spawnTimer -= dt;
      if (G.spawnTimer<=0 && G.enemiesSpawned<G.enemiesThisWave) {
        const n = (G.wave%5===0 && G.enemiesSpawned===0) ? 3 : 1;
        for (let i=0; i<n && G.enemiesSpawned<G.enemiesThisWave; i++) {
          spawnEnemy(); G.enemiesSpawned++;
        }
        G.spawnTimer = G.spawnInterval + rng(-0.1,0.1);
        if (G.wave%5===0 && G.enemiesSpawned===Math.floor(G.enemiesThisWave*0.5))
          spawnBoss();
      }
      if (G.enemiesSpawned>=G.enemiesThisWave && G.enemies.length===0) {
        G.waveState='waiting'; G.waveTimer=G.waveBreakDuration;
        const bonus = 5+G.wave*2;
        collectXP(G.player.x,G.player.y,bonus);
        showFloatingText(G.player.x,G.player.y-30,`+${bonus} XP (wave clear)`,'#a78bfa',1.5);
      }
      break;
    case 'waiting':
      G.waveTimer -= dt;
      if (G.waveTimer<=0) { G.waveState='idle'; G.waveTimer=0.5; }
      break;
  }
}

// ─── Projectiles ────────────────────────────
function fireProjectile() {
  const p = G.player;
  if (!p) return;
  let near=null, nd=Infinity;
  for (const e of G.enemies) {
    const d = dist(p,e);
    if (d < p.attackRange && d < nd) { nd=d; near=e; }
  }
  if (!near) return;
  const n = p.multishot;
  for (let i=0; i<n; i++) {
    const sp = (i-(n-1)/2)*0.15;
    const a = Math.atan2(near.y-p.y,near.x-p.x)+sp;
    G.projectiles.push({
      x:p.x,y:p.y, vx:Math.cos(a)*500, vy:Math.sin(a)*500,
      damage:p.damage, radius:4, life:1.5, trail:[],
      color:'#fbbf24', glow:'#f59e0b',
      pierce:p.piercing, homing:p.homing, explosive:p.explosive,
      chain:p.chain, hitEnemies:new Set(),
    });
  }
}

function updateProjectiles(dt) {
  for (let i=G.projectiles.length-1; i>=0; i--) {
    const pr = G.projectiles[i];
    pr.x += pr.vx*dt; pr.y += pr.vy*dt; pr.life -= dt;
    pr.trail.push({x:pr.x,y:pr.y,life:0.2});
    if (pr.trail.length > TRAIL_MAX) pr.trail.shift();
    for (const t of pr.trail) t.life -= dt;
    pr.trail = pr.trail.filter(t=>t.life>0);

    // Homing
    if (pr.homing>0) {
      let near=null, nd=Infinity;
      for (const e of G.enemies) {
        if (pr.hitEnemies.has(e)) continue;
        const d = dist(pr,e);
        if (d<nd) { nd=d; near=e; }
      }
      if (near && nd<400) {
        const ta = Math.atan2(near.y-pr.y,near.x-pr.x);
        const ca = Math.atan2(pr.vy,pr.vx);
        let diff = ta-ca; if (diff>PI) diff-=TAU; if (diff<-PI) diff+=TAU;
        const turn = diff*pr.homing*3*dt;
        const spd = Math.hypot(pr.vx,pr.vy);
        const na = ca+turn;
        pr.vx = Math.cos(na)*spd; pr.vy = Math.sin(na)*spd;
      }
    }

    let hit = false;
    for (const e of G.enemies) {
      if (pr.hitEnemies.has(e)) continue;
      if (dist(pr,e) < pr.radius+e.radius) {
        e.hp -= pr.damage; e.hitFlash = 0.1;
        hit = true; pr.hitEnemies.add(e);
        G.damageWindow.push({v:pr.damage,t:G.survivalTime});
        G.damageNumbers.push({x:e.x,y:e.y-e.radius, value:pr.damage, life:0.8,vy:-60,color:'#fbbf24'});
        for (let j=0;j<4;j++) addParticle(e.x,e.y, rng(-100,100),rng(-100,100), '#fbbf24','#f59e0b',0.3,0.5,3);
        const a=Math.atan2(e.y-pr.y,e.x-pr.x);
        e.x+=Math.cos(a)*8; e.y+=Math.sin(a)*8;
        sfx('hit');
        if (pr.explosive>0) { explosion(e.x,e.y,pr.explosive,pr.damage*0.6); sfx('explode'); }
        if (pr.chain>0) chainBounce(e,pr);
        if (pr.pierce>0) { pr.pierce--; pr.damage*=0.85; }
        else pr.life=0;
        if (e.hp<=0 && !e.dead) enemyDeath(e);
        break;
      }
    }
    if (hit && pr.life<=0 || pr.life<=0 ||
        pr.x<-50||pr.x>WORLD_W+50||pr.y<-50||pr.y>WORLD_H+50)
      G.projectiles.splice(i,1);
  }
}

function chainBounce(src, pp) {
  let near=null, nd=Infinity;
  for (const e of G.enemies) {
    if (pp.hitEnemies.has(e)) continue;
    const d = dist(src,e);
    if (d<nd && d<200) { nd=d; near=e; }
  }
  if (!near) return;
  const a = Math.atan2(near.y-src.y, near.x-src.x);
  G.projectiles.push({
    x:src.x,y:src.y, vx:Math.cos(a)*450,vy:Math.sin(a)*450,
    damage:pp.damage*0.7, radius:3, life:0.8, trail:[],
    color:'#60a5fa',glow:'#3b82f6',
    pierce:0, homing:pp.homing*0.5, explosive:0, chain:pp.chain-1,
    hitEnemies:new Set([...pp.hitEnemies]),
  });
}

function explosion(x,y,radius,damage) {
  for (let i=0;i<25;i++) {
    const a=rng(0,TAU), spd=rng(50,radius*1.5);
    addParticle(x,y,Math.cos(a)*spd,Math.sin(a)*spd,'#f97316','#ea580c',0.4,1,rng(2,5));
  }
  for (const e of G.enemies) {
    const d = dist({x,y}, e);
    if (d<radius) {
      const fall=1-(d/radius)*0.5;
      const dmg=Math.round(damage*fall);
      e.hp-=dmg; e.hitFlash=0.15;
      G.damageNumbers.push({x:e.x,y:e.y-e.radius,value:dmg,life:0.6,vy:-40,color:'#f97316'});
      if (e.hp<=0 && !e.dead) enemyDeath(e);
    }
  }
  G.shakeIntensity = Math.max(G.shakeIntensity, radius*0.3);
}

// ─── Enemy Behaviors ────────────────────────
function updateEnemyBehavior(e, dt) {
  const p=G.player;
  if (!p||!e.beh) return;
  e.behTimer += dt;
  switch(e.beh) {
    case 'phase':
      e.phaseAlpha = 0.4+0.4*Math.sin(e.behTimer*3);
      if (e.behTimer>3) { e.behTimer=0;
        const a=rng(0,TAU), d2=rng(60,150);
        e.x=safeClamp(e.x+Math.cos(a)*d2,20,WORLD_W-20);
        e.y=safeClamp(e.y+Math.sin(a)*d2,20,WORLD_H-20);
        for(let i=0;i<6;i++) addParticle(e.x+rng(-10,10),e.y+rng(-10,10),rng(-30,30),rng(-30,30),'#c4b5fd','#8b5cf6',0.3,0.5,2);
      }
      break;
    case 'ranged': {
      const d=dist(e,p);
      if (d<200) { const a=Math.atan2(e.y-p.y,e.x-p.x); e.x+=Math.cos(a)*e.speed*1.5*dt; e.y+=Math.sin(a)*e.speed*1.5*dt; }
      if (e.attackCooldown<=0 && d<400) {
        e.attackCooldown=2; const a=Math.atan2(p.y-e.y,p.x-e.x);
        G.enemyProjectiles.push({x:e.x,y:e.y,vx:Math.cos(a)*200,vy:Math.sin(a)*200,damage:e.damage,radius:5,life:3,color:'#34d399',glow:'#059669'});
      }
      break;
    }
    case 'berserk':
      if (!e.berserked && e.hp<e.maxHp*0.5) {
        e.berserked=true; e.speed*=2; e.damage*=1.5; e.color='#ef4444'; e.glowColor='#dc2626';
        for(let i=0;i<15;i++) addParticle(e.x,e.y,rng(-80,80),rng(-80,80),'#ef4444','#dc2626',0.5,0.7,4);
        showFloatingText(e.x,e.y-20,'💢 ENRAGED!','#ef4444',1.2);
      }
      break;
    case 'fireTrail':
      e.trailTimer-=dt;
      if (e.trailTimer<=0) {
        e.trailTimer=0.3;
        G.fireTrails.push({x:e.x,y:e.y,radius:30,life:3,maxLife:3,damage:e.damage*0.3});
      }
      break;
    case 'summon':
      e.summonCooldown-=dt;
      if (e.summonCooldown<=0 && G.enemies.length<50) {
        e.summonCooldown=4-Math.min(2,G.wave*0.05);
        for(let i=0;i<2;i++) { const a=rng(0,TAU), d2=rng(30,60);
          const bat=makeEnemy('bat',e.x+Math.cos(a)*d2,e.y+Math.sin(a)*d2);
          bat.hp=Math.round(bat.hp*0.7); bat.maxHp=bat.hp;
          G.enemies.push(bat);
        }
        sfx('summon');
        for(let i=0;i<8;i++) addParticle(e.x,e.y,rng(-60,60),rng(-60,60),'#a78bfa','#7c3aed',0.4,0.5,3);
      }
      break;
    case 'boss':
      if (e.attackCooldown<=0) {
        e.attackCooldown=3-Math.min(1.5,G.wave*0.05);
        for(let i=0;i<8;i++) {
          const a=(i/8)*TAU+e.behTimer*0.5;
          G.enemyProjectiles.push({x:e.x,y:e.y,vx:Math.cos(a)*120,vy:Math.sin(a)*120,damage:e.damage*0.5,radius:7,life:2.5,color:'#ef4444',glow:'#7f1d1d'});
        }
      }
      break;
  }
  if (e.attackCooldown>0) e.attackCooldown-=dt;
}

// ─── Enemies ────────────────────────────────
function enemyDeath(e) {
  if (e.dead) return; // prevent double-death
  e.dead = true;
  G.enemiesTotalKilled++; G.score+=e.xp*2;

  // Split
  if (e.beh==='split' && (!e.splitCount||e.splitCount<2)) {
    for(let i=0;i<2;i++) {
      const c=makeEnemy('golem',e.x+rng(-20,20),e.y+rng(-20,20));
      c.hp=Math.round(e.maxHp*0.4); c.maxHp=c.hp;
      c.radius=e.radius*0.7; c.splitCount=(e.splitCount||0)+1;
      c.xp=Math.round(e.xp*0.3);
      if (c.splitCount>=2) c.beh=null;
      G.enemies.push(c);
    }
    showFloatingText(e.x,e.y-20,'💥 SPLIT!','#be123c',0.8);
  }

  // Vampiric
  const p=G.player;
  if (p&&p.vampiric>0) {
    const h=p.vampiric; p.hp=Math.min(p.maxHp,p.hp+h);
    showFloatingText(p.x,p.y-30,`+${h}❤️`,'#ef4444',0.6); sfx('heal');
  }

  // Particles (no XP orbs — gates are the XP source now)
  const pc=e.isBoss?60:15;
  for(let i=0;i<pc;i++) { const a=rng(0,TAU),spd=rng(50,200); addParticle(e.x,e.y,Math.cos(a)*spd,Math.sin(a)*spd,e.color,e.glowColor,0.4,0.8,rng(2,5)); }
  if(e.isBoss) G.shakeIntensity=15;
  sfx('xp');
}

function updateEnemyProjectiles(dt) {
  const p=G.player;
  if(!p) return;
  for(let i=G.enemyProjectiles.length-1;i>=0;i--) {
    const b=G.enemyProjectiles[i];
    b.x+=b.vx*dt; b.y+=b.vy*dt; b.life-=dt;
    if (p.invincible<=0 && dist(b,p)<b.radius+p.radius) {
      p.hp-=b.damage; p.invincible=0.3;
      G.damageNumbers.push({x:p.x,y:p.y-p.radius,value:b.damage,life:0.8,vy:-60,color:'#ef4444'});
      for(let j=0;j<6;j++) addParticle(p.x,p.y,rng(-80,80),rng(-80,80),'#ef4444','#dc2626',0.3,0.5,3);
      G.shakeIntensity=6; sfx('damage');
      if(p.hp<=0){gameOver();return;}
      G.enemyProjectiles.splice(i,1); continue;
    }
    if(b.life<=0||b.x<-50||b.x>WORLD_W+50||b.y<-50||b.y>WORLD_H+50)
      G.enemyProjectiles.splice(i,1);
  }
}

function updateFireTrails(dt) {
  const p=G.player;
  for(let i=G.fireTrails.length-1;i>=0;i--) {
    const ft=G.fireTrails[i]; ft.life-=dt;
    if(p&&p.invincible<=0&&dist(ft,p)<ft.radius+p.radius) {
      p.hp-=ft.damage*dt*2;
      if(Math.random()<dt*3) sfx('hit');
      if(p.hp<=0){gameOver();return;}
    }
    if(ft.life<=0) G.fireTrails.splice(i,1);
  }
}

function updateEnemies(dt) {
  const p=G.player;
  if(!p) return;
  for(let i=G.enemies.length-1;i>=0;i--) {
    const e=G.enemies[i];
    if(e.hp<=0||e.dead){G.enemies.splice(i,1);continue;}
    updateEnemyBehavior(e,dt);
    // Guard: if any NaN crept in, reset position
    if (isNaN(e.x)||isNaN(e.y)) { e.x=G.cam.x+rng(-100,100); e.y=G.cam.y+rng(-100,100); }

    const a=Math.atan2(p.y-e.y,p.x-e.x);
    const d=dist(e,p);
    const spd=e.speed*(1+(d<50?0.5:0));
    e.x+=Math.cos(a)*spd*dt; e.y+=Math.sin(a)*spd*dt;
    e.x=safeClamp(e.x,10,WORLD_W-10); e.y=safeClamp(e.y,10,WORLD_H-10);
    e.angle+=dt*3;
    if(e.hitFlash>0) e.hitFlash-=dt;

    // Freeze Aura
    if(p.freezeAura>0 && d<p.attackRange*0.8) {
      e.x+=Math.cos(a)*spd*dt*-0.5; e.y+=Math.sin(a)*spd*dt*-0.5;
      if(Math.random()<dt*3) addParticle(e.x,e.y,rng(-10,10),rng(-10,10),'#93c5fd','#60a5fa',0.3,0.3,1);
    }
    // Fire Aura
    if(p.fireAura>0 && d<p.attackRange*0.7) {
      p.fireTimer+=dt;
      if(p.fireTimer>=0.5) {
        p.fireTimer=0; const bd=p.fireAura*0.5;
        e.hp-=bd; G.damageNumbers.push({x:e.x,y:e.y-e.radius,value:Math.round(bd),life:0.4,vy:-30,color:'#f97316'});
        for(let j=0;j<2;j++) addParticle(e.x,e.y,rng(-20,20),rng(-20,20),'#f97316','#ea580c',0.3,0.3,1);
        if(e.hp<=0&&!e.dead){enemyDeath(e);G.enemies.splice(i,1);continue;}
      }
    }

    // Contact damage
    e.attackCooldown-=dt;
    if(d<p.radius+e.radius+4 && e.attackCooldown<=0 && p.invincible<=0) {
      let dmg=e.damage;
      if(p.shieldCharges>0) {
        p.shieldCharges--; dmg=0;
        showFloatingText(p.x,p.y-p.radius-20,'🛡️ BLOCKED!','#60a5fa',0.6);
        for(let j=0;j<10;j++) addParticle(p.x,p.y,rng(-60,60),rng(-60,60),'#60a5fa','#3b82f6',0.4,0.5,3);
      }
      if(dmg>0) {
        p.hp-=dmg;
        G.damageNumbers.push({x:p.x,y:p.y-p.radius,value:dmg,life:0.8,vy:-60,color:'#ef4444'});
        for(let j=0;j<8;j++) addParticle(p.x,p.y,rng(-100,100),rng(-100,100),'#ef4444','#dc2626',0.3,0.5,3);
        G.shakeIntensity=8; sfx('damage');
      }
      p.invincible=0.3; e.attackCooldown=0.8;
      if(p.thorns>0 && dmg>0) {
        const rd=Math.round(dmg*p.thorns);
        e.hp-=rd; e.hitFlash=0.15;
        G.damageNumbers.push({x:e.x,y:e.y-e.radius,value:rd,life:0.5,vy:-40,color:'#fbbf24'});
        if(e.hp<=0&&!e.dead){enemyDeath(e);G.enemies.splice(i,1);continue;}
      }
      if(p.hp<=0){gameOver();return;}
    }
  }
}

// ─── XP ─────────────────────────────────────
// XP now comes from passing through gates (see updateGates). XP orbs have
// been removed; this hook is kept for the main loop and any direct grants.
function updateXP(dt) {
  // no-op: orbs removed; gates handle XP via updateGates()
}

function collectXP(x,y,amt) {
  G.xp+=amt; while(G.xp>=G.xpToNext){G.xp-=G.xpToNext;levelUp();} sfx('xp');
}

function levelUp() {
  G.level++; G.xpToNext=Math.round(10*Math.pow(1.25,G.level-1)); sfx('levelup');
  // Queue if a panel is already showing
  if (G.showingUpgrades) {
    G.pendingLevelUps++;
    return;
  }
  showUpgradePanel();
}

function showUpgradePanel() {
  const avail=UPGRADES.filter(u=>(G.upgradeLevels[u.id]||0)<u.maxLevel);
  const choices=[]; const pool=[...avail];
  for(let i=0;i<3&&pool.length>0;i++){const idx=randInt(0,pool.length-1);choices.push(pool[idx]);pool.splice(idx,1);}
  if(choices.length===0){G.score+=100;showFloatingText(G.cam.x,G.cam.y-100,'MAX LEVEL! +100 score','#fbbf24',2);return;}
  G.upgradeChoices=choices; G.showingUpgrades=true; G.paused=true; renderUpgradePanel();
}

function applyUpgrade(id) {
  G.upgradeLevels[id]=(G.upgradeLevels[id]||0)+1;
  const u=UPGRADES.find(x=>x.id===id);
  const lvl=G.upgradeLevels[id]; const p=G.player; if(!p) return;
  switch(id) {
    case'speed':p.speed*=(1+u.base);break;
    case'maxHp':p.maxHp+=u.base;p.hp=Math.min(p.hp+u.base,p.maxHp);break;
    case'damage':p.damage*=(1+u.base);break;
    case'attackSpeed':p.attackSpeed*=(1+u.base);break;
    case'range':p.attackRange*=(1+u.base);break;
    case'regen':p.regen+=u.base;break;
    case'multishot':p.multishot+=1;break;
    case'magnetism':p.magnetism*=(1+u.base);break;
    case'orbValue':p.orbValue*=(1+u.base);break;
    case'shield':p.shieldMaxCharges=lvl;p.shieldCharges=lvl;break;
    case'freezeAura':p.freezeAura+=u.base;break;
    case'fireAura':p.fireAura+=u.base;break;
    case'piercing':p.piercing+=1;break;
    case'homing':p.homing=Math.min(1,p.homing+u.base);break;
    case'explosive':p.explosive+=u.base;break;
    case'vampiric':p.vampiric+=u.base;break;
    case'chain':p.chain+=1;break;
    case'thorns':p.thorns+=u.base;break;
  }
  G.showingUpgrades=false; G.paused=false;
  document.getElementById('upgrade-panel').style.display='none';
  showFloatingText(G.cam.x,G.cam.y-60,`${u.icon} ${u.name} Lv.${lvl}!`,'#4ade80',1.5);
  // Show next queued level-up panel
  if (G.pendingLevelUps > 0) {
    G.pendingLevelUps--;
    setTimeout(showUpgradePanel, 250);
  }
}

// ─── Player ──────────────────────────────────
function updatePlayer(dt) {
  const p=G.player; if(!p) return;
  if(p.invincible>0) p.invincible-=dt;
  if(p.regen>0&&p.hp<p.maxHp) p.hp=Math.min(p.maxHp,p.hp+p.regen*dt);
  // Shield recharge
  if(p.shieldCharges<p.shieldMaxCharges) {
    p.shieldCooldown-=dt;
    if(p.shieldCooldown<=0){p.shieldCooldown=8;p.shieldCharges++;showFloatingText(p.x,p.y-p.radius-35,'🛡️','#60a5fa',0.8);}
  }
  const {dx,dy}=getInput(dt);
  // Super Monkey Ball–style momentum: accelerate toward the target velocity
  // determined by input, and coast with friction when no input is applied.
  // This gives the marble weight — it builds speed and slides before stopping.
  const tx=dx*p.speed, ty=dy*p.speed;
  const accelRate=Math.min(1, p.accel*dt);
  p.velX+=(tx-p.velX)*accelRate;
  p.velY+=(ty-p.velY)*accelRate;
  if (dx===0 && dy===0) {
    const f=Math.pow(p.friction, dt);
    p.velX*=f; p.velY*=f;
  }
  p.x+=p.velX*dt; p.y+=p.velY*dt;
  // Guard against NaN
  if (isNaN(p.x)||isNaN(p.y)) { p.x=WORLD_W/2; p.y=WORLD_H/2; }
  p.x=safeClamp(p.x,20,WORLD_W-20); p.y=safeClamp(p.y,20,WORLD_H-20);
  if(Math.abs(p.velX)>1||Math.abs(p.velY)>1) p.facing=Math.atan2(p.velY,p.velX);
  // Rolling: accumulate rotation from distance travelled so the texture
  // visibly spins as the marble moves. rollAxis is the movement direction;
  // the texture rotates around the axis perpendicular to it.
  const speed = Math.hypot(p.velX, p.velY);
  if (speed > 1) {
    p.rollAxis = Math.atan2(p.velY, p.velX);
    p.rollAngle += (speed * dt) / p.radius;
  }
  // Auto-attack
  p.attackCooldown-=dt;
  if(p.attackCooldown<=0&&G.enemies.length>0){
    let has=false;
    for(const e of G.enemies){if(dist(p,e)<p.attackRange){has=true;break;}}
    if(has){fireProjectile();p.attackCooldown=1/p.attackSpeed;}
  }
  G.damageWindow=G.damageWindow.filter(d=>d.t>G.survivalTime-2);
  G.dps=(G.damageWindow.reduce((s,d)=>s+d.v,0))/2;
}

// ─── Particles ──────────────────────────────
function addParticle(x,y,vx,vy,color,glow,life,sizeMult=1,count=1) {
  if (G.particles.length >= PARTICLE_CAP) return;
  for(let i=0;i<count;i++) G.particles.push({x,y,vx:vx+rng(-20,20),vy:vy+rng(-20,20),color,glow,life:life*rng(0.5,1),maxLife:life,radius:rng(2,4)*sizeMult});
}
function updateParticles(dt) {
  for(let i=G.particles.length-1;i>=0;i--){const p=G.particles[i];p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=200*dt;p.vx*=0.98;p.vy*=0.98;p.life-=dt;if(p.life<=0)G.particles.splice(i,1);}
}
function showFloatingText(x,y,text,color,life=1.0){G.floatingTexts.push({x,y,text,color,life,maxLife:life,vy:-50});}
function updateFloatingTexts(dt){for(let i=G.floatingTexts.length-1;i>=0;i--){const f=G.floatingTexts[i];f.y+=f.vy*dt;f.life-=dt;if(f.life<=0)G.floatingTexts.splice(i,1);}}
function updateDamageNumbers(dt){for(let i=G.damageNumbers.length-1;i>=0;i--){const d=G.damageNumbers[i];d.y+=d.vy*dt;d.life-=dt;if(d.life<=0)G.damageNumbers.splice(i,1);}}
function updateShake(dt){if(G.shakeIntensity>0){G.shakeX=rng(-1,1)*G.shakeIntensity;G.shakeY=rng(-1,1)*G.shakeIntensity;G.shakeIntensity*=0.9;if(G.shakeIntensity<0.5)G.shakeIntensity=0;}else{G.shakeX=0;G.shakeY=0;}}

// ─── Rendering ──────────────────────────────
function render() {
  const ctx=G.ctx, W=G.W, H=G.H;
  const dpr=window.devicePixelRatio||1;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.save();
  ctx.translate(G.shakeX, G.shakeY);

  // Background
  ctx.fillStyle='#0f0f23';
  ctx.fillRect(-10,-10,W+20,H+20);

  // Camera-relative helpers
  const cx = G.cam.x - W/2;
  const cy = G.cam.y - H/2;

  // Grid (world-aligned)
  ctx.strokeStyle='rgba(255,255,255,0.03)';
  ctx.lineWidth=1;
  const gs=GRID_SIZE;
  const startX=Math.floor(cx/gs)*gs;
  const startY=Math.floor(cy/gs)*gs;
  for(let x=startX; x<cx+W+gs; x+=gs){ctx.beginPath();ctx.moveTo(x-cx,0);ctx.lineTo(x-cx,H);ctx.stroke();}
  for(let y=startY; y<cy+H+gs; y+=gs){ctx.beginPath();ctx.moveTo(0,y-cy);ctx.lineTo(W,y-cy);ctx.stroke();}

  // World border
  ctx.strokeStyle='rgba(255,0,0,0.15)';
  ctx.lineWidth=4;
  ctx.strokeRect(-cx,-cy,WORLD_W,WORLD_H);

  // Decorations
  for (const d of G.decorations) {
    const dx=d.x-cx, dy=d.y-cy;
    // Culling
    if (dx<-50||dx>W+50||dy<-50||dy>H+50) continue;
    ctx.save();
    ctx.translate(dx,dy);
    ctx.rotate(d.angle);
    ctx.scale(d.scale,d.scale);
    ctx.fillStyle = d.color;
    ctx.shadowColor = d.glow;
    ctx.shadowBlur = 5;
    const r = d.radius; // shared across all decoration types

    if (d.type==='tombstone') {
      // Rounded rectangle with rounded top
      ctx.beginPath();
      ctx.moveTo(-r*0.6,r); ctx.lineTo(-r*0.6,-r*0.3);
      ctx.quadraticCurveTo(-r*0.6,-r*0.8,0,-r);
      ctx.quadraticCurveTo(r*0.6,-r*0.8,r*0.6,-r*0.3);
      ctx.lineTo(r*0.6,r);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle='rgba(255,255,255,0.05)';
      ctx.fillRect(-r*0.3, -r*0.5, r*0.6, r*0.2);
    } else if (d.type==='tree') {
      ctx.beginPath();
      ctx.arc(0,d.radius*0.4,d.radius,0,TAU); ctx.fill();
      ctx.fillStyle='#2a1a0a';
      ctx.fillRect(-r*0.15,d.radius*0.4,r*0.3,r*0.6);
    } else if (d.type==='ruin') {
      for (let i=0;i<3;i++) {
        const px = (i-1)*r*0.5;
        ctx.fillStyle = i%2===0 ? d.color : '#2a2a3a';
        ctx.fillRect(px, -r*0.5, r*0.35, r);
        ctx.fillRect(px+r*0.02, -r*0.5+r*0.1, r*0.3, r*0.4);
      }
    } else if (d.type==='puddle') {
      ctx.beginPath(); ctx.ellipse(0,0,r*1.2,r*0.7,0,0,TAU); ctx.fill();
    } else if (d.type==='bloodpool') {
      ctx.fillStyle = '#3a0a0a';
      ctx.shadowColor = '#2a0000'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.ellipse(0,0,r*1.1,r*0.5,0.3,0,TAU); ctx.fill();
    } else if (d.type==='crystal') {
      ctx.beginPath();
      ctx.moveTo(0,-r); ctx.lineTo(-r*0.6,r*0.5); ctx.lineTo(r*0.6,r*0.5);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle='rgba(255,255,255,0.1)';
      ctx.beginPath();
      ctx.moveTo(0,-r*0.5); ctx.lineTo(-r*0.3,r*0.2); ctx.lineTo(r*0.3,r*0.2);
      ctx.closePath(); ctx.fill();
    }
    ctx.shadowBlur=0;
    ctx.restore();
  }

  // Fire trails
  for (const ft of G.fireTrails) {
    const fx=ft.x-cx, fy=ft.y-cy;
    const alpha=ft.life/ft.maxLife;
    ctx.save(); ctx.globalAlpha=alpha*0.5;
    const g=ctx.createRadialGradient(fx,fy,0,fx,fy,ft.radius);
    g.addColorStop(0,'#ef444480'); g.addColorStop(0.5,'#f9731640'); g.addColorStop(1,'#f9731600');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(fx,fy,ft.radius,0,TAU); ctx.fill();
    ctx.restore();
  }

  // Gates (XP source)
  for(const g of G.gates){
    const gx=g.x-cx, gy=g.y-cy;
    if(gx<-80||gx>W+80||gy<-80||gy>H+80)continue;
    const pulse=0.5+0.5*Math.sin(g.pulse);
    const reach=g.radius+ (G.player?G.player.magnetism*0.1:0);
    ctx.save();
    // Outer capture aura (faint)
    ctx.globalAlpha=0.12+0.08*pulse;
    const ag=ctx.createRadialGradient(gx,gy,g.radius*0.4,gx,gy,reach);
    ag.addColorStop(0,g.glow+'00'); ag.addColorStop(0.7,g.glow+'55'); ag.addColorStop(1,g.glow+'00');
    ctx.fillStyle=ag; ctx.beginPath(); ctx.arc(gx,gy,reach,0,TAU); ctx.fill();
    ctx.globalAlpha=1;
    // Two posts
    ctx.strokeStyle=g.color; ctx.lineWidth=4; ctx.lineCap='round';
    ctx.shadowColor=g.glow; ctx.shadowBlur=18+10*pulse;
    ctx.beginPath();
    ctx.arc(gx,gy,g.radius, g.spin, g.spin+0.9); ctx.stroke();
    ctx.beginPath();
    ctx.arc(gx,gy,g.radius, g.spin+Math.PI, g.spin+Math.PI+0.9); ctx.stroke();
    // Energy ring (full, fainter)
    ctx.globalAlpha=0.4+0.3*pulse; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(gx,gy,g.radius,0,TAU); ctx.stroke();
    ctx.shadowBlur=0;
    // Inner core glow
    ctx.globalAlpha=0.5*pulse;
    const cg=ctx.createRadialGradient(gx,gy,0,gx,gy,g.radius*0.5);
    cg.addColorStop(0,g.glow+'aa'); cg.addColorStop(1,g.glow+'00');
    ctx.fillStyle=cg; ctx.beginPath(); ctx.arc(gx,gy,g.radius*0.5,0,TAU); ctx.fill();
    // Value label
    ctx.globalAlpha=1; ctx.fillStyle='#fff'; ctx.font='bold 13px system-ui,sans-serif';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.shadowColor='rgba(0,0,0,0.8)'; ctx.shadowBlur=3;
    ctx.fillText('+'+g.value, gx, gy);
    ctx.restore();
  }

  // Particles
  for(const p of G.particles){
    const px=p.x-cx, py=p.y-cy;
    const alpha=p.life/p.maxLife;
    ctx.save(); ctx.globalAlpha=alpha;
    ctx.fillStyle=p.color; ctx.shadowColor=p.glow||p.color; ctx.shadowBlur=8;
    ctx.beginPath(); ctx.arc(px,py,p.radius*alpha,0,TAU); ctx.fill(); ctx.shadowBlur=0; ctx.restore();
  }

  // Projectile trails
  for(const pr of G.projectiles){
    for(const t of pr.trail){
      const tx=t.x-cx, ty=t.y-cy;
      const alpha=t.life/0.2;
      ctx.save(); ctx.globalAlpha=alpha*0.3;
      ctx.fillStyle=pr.color; ctx.beginPath(); ctx.arc(tx,ty,pr.radius*alpha,0,TAU); ctx.fill(); ctx.restore();
    }
  }

  // Player projectiles
  for(const pr of G.projectiles){
    const px=pr.x-cx, py=pr.y-cy;
    ctx.save();
    const g=ctx.createRadialGradient(px,py,0,px,py,pr.radius*4);
    g.addColorStop(0,pr.glow+'60'); g.addColorStop(1,pr.glow+'00');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(px,py,pr.radius*4,0,TAU); ctx.fill();
    ctx.fillStyle=pr.color; ctx.shadowColor=pr.glow; ctx.shadowBlur=15;
    ctx.beginPath(); ctx.arc(px,py,pr.radius,0,TAU); ctx.fill(); ctx.shadowBlur=0; ctx.restore();
  }

  // Enemy projectiles
  for(const b of G.enemyProjectiles){
    const bx=b.x-cx, by=b.y-cy;
    ctx.save();
    const g=ctx.createRadialGradient(bx,by,0,bx,by,b.radius*3);
    g.addColorStop(0,b.glow+'50'); g.addColorStop(1,b.glow+'00');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(bx,by,b.radius*3,0,TAU); ctx.fill();
    ctx.fillStyle=b.color; ctx.shadowColor=b.glow; ctx.shadowBlur=12;
    ctx.beginPath(); ctx.arc(bx,by,b.radius,0,TAU); ctx.fill(); ctx.shadowBlur=0; ctx.restore();
  }

  // Enemies
  for(const e of G.enemies){
    const ex=e.x-cx, ey=e.y-cy;
    if(ex<-50||ex>W+50||ey<-50||ey>H+50)continue;
    ctx.save();
    const flash=e.hitFlash>0;
    if(e.beh==='phase'){ctx.globalAlpha=e.phaseAlpha;ctx.shadowColor=e.glowColor;ctx.shadowBlur=15;}
    else{ctx.shadowColor=e.glowColor;ctx.shadowBlur=flash?20:10;}
    ctx.fillStyle=flash?'#ffffff':e.color;
    ctx.beginPath(); ctx.arc(ex,ey,e.radius,0,TAU); ctx.fill();
    if(!flash&&e.beh!=='phase'){
      const g=ctx.createRadialGradient(ex-e.radius*0.3,ey-e.radius*0.3,0,ex,ey,e.radius);
      g.addColorStop(0,'rgba(255,255,255,0.2)');g.addColorStop(1,'rgba(0,0,0,0.2)');
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(ex,ey,e.radius,0,TAU); ctx.fill();
    }

    // Unique visuals
    if(e.type==='witch'){
      ctx.shadowBlur=0; ctx.fillStyle='#064e3b';
      ctx.beginPath(); ctx.moveTo(ex-e.radius,ey-e.radius*0.3); ctx.lineTo(ex,ey-e.radius*1.3); ctx.lineTo(ex+e.radius,ey-e.radius*0.3); ctx.closePath(); ctx.fill();
      ctx.strokeStyle='#064e3b'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(ex-e.radius*1.2,ey-e.radius*0.3); ctx.lineTo(ex+e.radius*1.2,ey-e.radius*0.3); ctx.stroke();
    } else if(e.type==='werewolf'){
      ctx.shadowBlur=0; ctx.fillStyle=e.berserked?'#dc2626':'#713f12';
      ctx.beginPath(); ctx.moveTo(ex-e.radius*0.7,ey-e.radius*0.3); ctx.lineTo(ex-e.radius*0.4,ey-e.radius*1.1); ctx.lineTo(ex-e.radius*0.1,ey-e.radius*0.3); ctx.fill();
      ctx.beginPath(); ctx.moveTo(ex+e.radius*0.1,ey-e.radius*0.3); ctx.lineTo(ex+e.radius*0.4,ey-e.radius*1.1); ctx.lineTo(ex+e.radius*0.7,ey-e.radius*0.3); ctx.fill();
    } else if(e.type==='hellhound'){
      ctx.shadowBlur=0;
      for(let i=0;i<5;i++){const a=-PI/2+(i-2)*0.3+Math.sin(e.behTimer*5+i)*0.2;ctx.fillStyle=['#f97316','#fb923c','#fbbf24'][i%3];ctx.beginPath();ctx.arc(ex+Math.cos(a)*e.radius*0.7,ey+Math.sin(a)*e.radius*0.5,3,0,TAU);ctx.fill();}
    } else if(e.type==='necro'){
      ctx.shadowBlur=0; ctx.strokeStyle='#a78bfa'; ctx.lineWidth=2; ctx.setLineDash([3,5]);
      ctx.beginPath(); ctx.arc(ex,ey,e.radius*1.3,0,TAU); ctx.stroke(); ctx.setLineDash([]);
    } else if(e.type==='golem'){
      ctx.shadowBlur=0; ctx.strokeStyle='#881337'; ctx.lineWidth=1.5;
      for(let i=0;i<3;i++){const a=e.angle+i*2.1;ctx.beginPath();ctx.moveTo(ex,ey);ctx.lineTo(ex+Math.cos(a)*e.radius*0.8,ey+Math.sin(a)*e.radius*0.8);ctx.stroke();}
    }

    // Boss crown
    if(e.isBoss){
      ctx.strokeStyle='#fbbf24';ctx.lineWidth=3;ctx.shadowColor='#fbbf24';ctx.shadowBlur=10;
      const ch=e.radius*0.5, cw=e.radius*0.6;
      ctx.beginPath(); ctx.moveTo(ex-cw,ey-e.radius-5); ctx.lineTo(ex-cw+5,ey-e.radius-ch); ctx.lineTo(ex-cw/3,ey-e.radius-ch*0.6); ctx.lineTo(ex,ey-e.radius-ch); ctx.lineTo(ex+cw/3,ey-e.radius-ch*0.6); ctx.lineTo(ex+cw-5,ey-e.radius-ch); ctx.lineTo(ex+cw,ey-e.radius-5); ctx.closePath(); ctx.stroke(); ctx.shadowBlur=0;
    }

    // Eyes
    ctx.shadowBlur=0;
    const eo=e.radius*0.3, er2=e.radius*0.2;
    ctx.fillStyle=flash?'#ef4444':'#ef4444';
    ctx.beginPath(); ctx.arc(ex-eo,ey-eo*0.5,er2,0,TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(ex+eo,ey-eo*0.5,er2,0,TAU); ctx.fill();
    ctx.fillStyle='#000';
    ctx.beginPath(); ctx.arc(ex-eo+Math.cos(e.angle)*2,ey-eo*0.5+Math.sin(e.angle)*2,er2*0.5,0,TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(ex+eo+Math.cos(e.angle)*2,ey-eo*0.5+Math.sin(e.angle)*2,er2*0.5,0,TAU); ctx.fill();

    // HP bar
    if(e.hp<e.maxHp&&!flash){
      const bw=e.radius*2.5,bh=4;
      ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(ex-bw/2,ey-e.radius-10,bw,bh);
      ctx.fillStyle=e.hp/e.maxHp>0.5?'#4ade80':e.hp/e.maxHp>0.25?'#fbbf24':'#ef4444';
      ctx.fillRect(ex-bw/2,ey-e.radius-10,bw*(e.hp/e.maxHp),bh);
    }
    ctx.restore();
  }

  // Player marble (textured, rolling)
  const p=G.player;
  if(p){
    const px=p.x-cx, py=p.y-cy;
    const r=p.radius;
    ctx.save();
    const iA=p.invincible>0?0.6+Math.sin(p.invincible*60)*0.4:1;
    ctx.globalAlpha=iA;
    if(p.freezeAura>0){ctx.strokeStyle='rgba(147,197,253,0.15)';ctx.lineWidth=2;ctx.setLineDash([5,10]);ctx.shadowBlur=0;ctx.beginPath();ctx.arc(px,py,p.attackRange*0.8,0,TAU);ctx.stroke();ctx.setLineDash([]);}
    if(p.fireAura>0){ctx.strokeStyle='rgba(249,115,22,0.15)';ctx.lineWidth=2;ctx.shadowBlur=0;ctx.beginPath();ctx.arc(px,py,p.attackRange*0.7,0,TAU);ctx.stroke();if(Math.random()<0.3){const a=rng(0,TAU),rr=rng(p.attackRange*0.3,p.attackRange*0.7);addParticle(px+Math.cos(a)*rr,py+Math.sin(a)*rr,rng(-10,10),rng(-20,-5),'#f97316','#ea580c',0.3,0.3,1);}}
    if(p.shieldCharges>0){ctx.strokeStyle='rgba(96,165,250,0.3)';ctx.lineWidth=2;ctx.shadowColor='#60a5fa';ctx.shadowBlur=15;ctx.beginPath();ctx.arc(px,py,r+8,0,TAU);ctx.stroke();ctx.shadowBlur=0;}

    // Outer glow
    const gg=ctx.createRadialGradient(px,py,0,px,py,r*4);
    gg.addColorStop(0,'rgba(59,130,246,0.3)');gg.addColorStop(1,'rgba(59,130,246,0)');
    ctx.fillStyle=gg;ctx.shadowBlur=0;ctx.beginPath();ctx.arc(px,py,r*4,0,TAU);ctx.fill();

    // Clip to the marble circle so the texture stays inside
    ctx.save();
    ctx.beginPath(); ctx.arc(px,py,r,0,TAU); ctx.clip();

    // Base sphere gradient (fixed — represents the lit body)
    ctx.shadowColor='#3b82f6';ctx.shadowBlur=20;
    const gd=ctx.createRadialGradient(px-r*0.3,py-r*0.3,r*0.1,px,py,r);
    gd.addColorStop(0,'#93c5fd');gd.addColorStop(0.4,'#3b82f6');gd.addColorStop(0.8,'#1d4ed8');gd.addColorStop(1,'#1e3a8a');
    ctx.fillStyle=gd;ctx.beginPath();ctx.arc(px,py,r,0,TAU);ctx.fill();ctx.shadowBlur=0;

    // Rotating texture: translate to ball center, rotate by rollAxis, then
    // shift along the perpendicular axis by rollAngle*r to simulate the
    // surface wrapping as the ball rolls.
    ctx.translate(px,py);
    ctx.rotate(p.rollAxis);
    // The "contact patch" moves; offset the texture along the rolling axis
    // by an amount proportional to rollAngle so the pattern flows.
    const offset = (p.rollAngle * r) % (r*2);
    // Draw repeating bands along the roll direction
    ctx.fillStyle='rgba(255,255,255,0.18)';
    for (let bx = -r*2; bx <= r*2; bx += r*0.8) {
      const x = bx + offset;
      ctx.fillRect(x - r*0.18, -r, r*0.36, r*2);
    }
    // A contrasting equator band (darker) so rotation is obvious
    ctx.fillStyle='rgba(30,58,138,0.55)';
    for (let bx = -r*2; bx <= r*2; bx += r*0.8) {
      const x = bx + offset + r*0.4;
      ctx.fillRect(x - r*0.06, -r, r*0.12, r*2);
    }
    // A couple of bright "spots" that orbit as the ball rolls
    ctx.fillStyle='rgba(255,255,255,0.85)';
    for (let i=0;i<3;i++) {
      const sx = ((i*r*0.8 + offset) % (r*2)) - r;
      ctx.beginPath(); ctx.arc(sx, 0, r*0.13, 0, TAU); ctx.fill();
    }
    ctx.restore(); // end clip

    // Fixed specular highlights (light from top-left, don't rotate)
    ctx.save();
    ctx.beginPath(); ctx.arc(px,py,r,0,TAU); ctx.clip();
    const sp=ctx.createRadialGradient(px-r*0.3,py-r*0.35,0,px-r*0.3,py-r*0.35,r*0.5);
    sp.addColorStop(0,'rgba(255,255,255,0.7)');sp.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=sp;ctx.beginPath();ctx.arc(px,py,r,0,TAU);ctx.fill();
    const sp2=ctx.createRadialGradient(px-r*0.5,py-r*0.5,0,px-r*0.5,py-r*0.5,r*0.2);
    sp2.addColorStop(0,'rgba(255,255,255,0.95)');sp2.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=sp2;ctx.beginPath();ctx.arc(px,py,r,0,TAU);ctx.fill();
    ctx.restore();

    // Rim
    ctx.strokeStyle='rgba(255,255,255,0.15)';ctx.lineWidth=1;
    ctx.beginPath();ctx.arc(px,py,r,0,TAU);ctx.stroke();

    // Attack range indicator
    ctx.strokeStyle='rgba(59,130,246,0.1)';ctx.lineWidth=1;ctx.setLineDash([4,8]);
    ctx.beginPath();ctx.arc(px,py,p.attackRange,0,TAU);ctx.stroke();ctx.setLineDash([]);
    ctx.restore();
  }

  // Floating texts & damage numbers
  for(const f of G.floatingTexts){const alpha=f.life/f.maxLife;ctx.save();ctx.globalAlpha=alpha;ctx.fillStyle=f.color;ctx.font='bold 20px system-ui,sans-serif';ctx.textAlign='center';ctx.shadowColor='rgba(0,0,0,0.8)';ctx.shadowBlur=4;ctx.fillText(f.text,f.x-cx,f.y-cy);ctx.restore();}
  for(const d of G.damageNumbers){const alpha=d.life/0.8;ctx.save();ctx.globalAlpha=alpha;ctx.fillStyle=d.color;ctx.font='bold 16px system-ui,sans-serif';ctx.textAlign='center';ctx.shadowColor='rgba(0,0,0,0.8)';ctx.shadowBlur=3;ctx.fillText(Math.round(d.value),d.x-cx,d.y-cy);ctx.restore();}

  ctx.restore(); // shake

  renderHUD();
  renderMinimap();
}

// ─── Minimap ────────────────────────────────
function renderMinimap() {
  const ctx=G.ctx, W=G.W, H=G.H, p=G.player;
  if(!p) return;

  const mmSize = 120;
  const mmPad = 10;
  const mmX = W - mmSize - mmPad;
  const mmY = mmPad;
  const scale = mmSize / Math.max(WORLD_W, WORLD_H);

  // Background
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.fillRect(mmX, mmY, mmSize, mmSize);
  ctx.strokeRect(mmX, mmY, mmSize, mmSize);

  // Camera view rect
  const camW = W * scale;
  const camH = H * scale;
  const camMX = mmX + (G.cam.x - W/2) * scale;
  const camMY = mmY + (G.cam.y - H/2) * scale;
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.strokeRect(camMX, camMY, camW, camH);

  // Enemies
  ctx.fillStyle = '#ef4444';
  for (const e of G.enemies) {
    const ex = mmX + e.x * scale;
    const ey = mmY + e.y * scale;
    if (ex < mmX || ex > mmX+mmSize || ey < mmY || ey > mmY+mmSize) continue;
    ctx.fillRect(ex-1, ey-1, 3, 3);
  }

  // Gates (XP)
  for (const g of G.gates) {
    const gx = mmX + g.x * scale;
    const gy = mmY + g.y * scale;
    if (gx < mmX || gx > mmX+mmSize || gy < mmY || gy > mmY+mmSize) continue;
    ctx.fillStyle = g.color;
    ctx.beginPath();
    ctx.arc(gx, gy, 2.5, 0, TAU);
    ctx.fill();
  }

  // Player
  ctx.fillStyle = '#3b82f6';
  const pmx = mmX + p.x * scale;
  const pmy = mmY + p.y * scale;
  ctx.beginPath();
  ctx.arc(pmx, pmy, 3, 0, TAU);
  ctx.fill();

  // Label
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.font = '9px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('MAP', mmX + mmSize/2, mmY + mmSize + 12);
}

function renderHUD() {
  const ctx=G.ctx, W=G.W, H=G.H, p=G.player;
  if(!p) return;
  const pad=16, bh=14;
  const bw=Math.min(280,W-pad*2);
  const bx=(W-bw)/2;

  // HP
  const hpY=H-pad-bh-40;
  ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(bx-1,hpY-1,bw+2,bh+2);
  const hr=Math.max(0,p.hp/p.maxHp);
  ctx.fillStyle=hr>0.5?'#4ade80':hr>0.25?'#fbbf24':'#ef4444';
  ctx.fillRect(bx,hpY,bw*hr,bh);
  ctx.fillStyle='rgba(255,255,255,0.9)'; ctx.font='bold 11px system-ui,sans-serif'; ctx.textAlign='center';
  ctx.fillText(`❤️ ${Math.ceil(p.hp)}/${p.maxHp}${p.shieldCharges>0?' 🛡️'+p.shieldCharges:''}`,W/2,hpY+11);

  // XP
  const xpY=H-pad-bh;
  ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(bx-1,xpY-1,bw+2,bh+2);
  ctx.fillStyle='#a78bfa'; ctx.fillRect(bx,xpY,bw*(G.xp/G.xpToNext),bh);
  ctx.fillStyle='rgba(255,255,255,0.9)'; ctx.font='bold 11px system-ui,sans-serif'; ctx.textAlign='center';
  ctx.fillText(`💎 Lv.${G.level} ${G.xp}/${G.xpToNext}`,W/2,xpY+11);

  // Top-left
  ctx.textAlign='left'; ctx.fillStyle='rgba(255,255,255,0.8)'; ctx.font='14px system-ui,sans-serif';
  ctx.fillText(`🌊 Wave ${G.wave}`,pad,pad+16);
  ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.font='12px system-ui,sans-serif';
  ctx.fillText(`⏱ ${fmtTime(G.survivalTime)}`,pad,pad+34);
  ctx.fillText(`💀 ${G.enemiesTotalKilled} kills`,pad,pad+50);

  // Top-right
  ctx.textAlign='right'; ctx.fillStyle='rgba(255,255,255,0.6)'; ctx.font='12px system-ui,sans-serif';
  ctx.fillText(`⚔️ ${Math.round(G.dps)} DPS`,W-pad,pad+16);
  ctx.fillText(`🏆 ${G.score}`,W-pad,pad+34);
  const ae=G.enemies.length;
  ctx.fillStyle=ae>20?'#ef4444':ae>10?'#fbbf24':'rgba(255,255,255,0.3)';
  ctx.fillText(`👾 ${ae} left`,W-pad,pad+50);

  // Active upgrades (compact)
  let ugx=pad; const ugy=pad+70;
  const entries=Object.entries(G.upgradeLevels).slice(0,8);
  for(const[id,lvl]of entries){const u=UPGRADES.find(x=>x.id===id);if(!u)continue;ctx.textAlign='left';ctx.font='11px system-ui,sans-serif';ctx.fillStyle='rgba(255,255,255,0.5)';ctx.fillText(`${u.icon}${lvl}`,ugx,ugy);ugx+=28;if(ugx>W-pad)break;}
  const rem=Object.entries(G.upgradeLevels).length-entries.length;
  if(rem>0){ctx.textAlign='left';ctx.font='10px system-ui,sans-serif';ctx.fillStyle='rgba(255,255,255,0.3)';ctx.fillText(`+${rem} more`,ugx,ugy);}

  // Control mode indicator (shows live gyro status)
  ctx.textAlign='right'; ctx.font='10px system-ui,sans-serif';
  let modeTxt='🖱️ Touch'; let modeClr='rgba(255,255,255,0.3)';
  if (G.gyroActive && G.gyroSupported) {
    if (G.gyroEventsReceived>0 && (G.survivalTime-G.gyroLastTime)<1.0) {
      modeTxt='🎯 Gyro (live)'; modeClr='#4ade80';
    } else if (G.gyroEventsReceived>0) {
      modeTxt='🎯 Gyro (idle)'; modeClr='#fbbf24';
    } else {
      modeTxt='🎯 Gyro (waiting…)'; modeClr='#fbbf24';
    }
  }
  ctx.fillStyle=modeClr;
  ctx.fillText(modeTxt,W-pad,H-pad-70);

  // Wave countdown
  if(G.waveState==='idle'&&G.waveTimer>0&&G.wave>0){
    ctx.textAlign='center'; ctx.fillStyle='rgba(255,255,255,0.4)'; ctx.font='14px system-ui,sans-serif';
    ctx.fillText(`Next wave in ${Math.ceil(G.waveTimer)}s`,W/2,H/2+40);
  }

  // Pause overlay
  if (G.paused && !G.gameOver && !G.showingUpgrades) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0,0,W,H);
    ctx.textAlign = 'center'; ctx.fillStyle = '#fbbf24'; ctx.font = 'bold 40px system-ui,sans-serif';
    ctx.fillText('⏸ PAUSED', W/2, H/2);
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '14px system-ui,sans-serif';
    ctx.fillText('Press P or Space to resume', W/2, H/2 + 30);
  }

  // Game Over
  if(G.gameOver){
    ctx.fillStyle='rgba(0,0,0,0.65)'; ctx.fillRect(0,0,W,H);
    ctx.textAlign='center'; ctx.fillStyle='#ef4444'; ctx.font='bold 48px system-ui,sans-serif';
    ctx.fillText('☠️ GAME OVER',W/2,H/2-100);
    ctx.fillStyle='#fbbf24'; ctx.font='bold 32px system-ui,sans-serif';
    ctx.fillText(`Score: ${G.score}`,W/2,H/2-40);
    ctx.fillStyle='rgba(255,255,255,0.7)'; ctx.font='20px system-ui,sans-serif';
    ctx.fillText(`Survived: ${fmtTime(G.survivalTime)}`,W/2,H/2+10);
    ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.font='16px system-ui,sans-serif';
    ctx.fillText(`Level ${G.level}  •  ${G.enemiesTotalKilled} kills  •  Wave ${G.wave}`,W/2,H/2+45);
    ctx.fillStyle='rgba(255,255,255,0.3)'; ctx.font='14px system-ui,sans-serif';
    ctx.fillText(`${Math.round(G.dps)} DPS  •  ${Object.keys(G.upgradeLevels).length} upgrades`,W/2,H/2+75);
    ctx.fillStyle='rgba(255,255,255,0.4)'; ctx.font='16px system-ui,sans-serif';
    ctx.fillText('Tap or click to restart',W/2,H/2+130);
  }
}

function fmtTime(s){const m=Math.floor(s/60),sec=Math.floor(s%60);return `${m}:${sec.toString().padStart(2,'0')}`;}

// ─── Upgrade Panel ──────────────────────────
function renderUpgradePanel() {
  const panel=document.getElementById('upgrade-panel');
  const container=document.getElementById('upgrade-choices');
  if (!panel||!container) return;
  container.innerHTML='';
  G.upgradeChoices.forEach(u=>{
    const lvl=G.upgradeLevels[u.id]||0;
    const card=document.createElement('div'); card.className='upgrade-card';
    const isNew=lvl===0;
    card.innerHTML=`<div class="upgrade-icon">${u.icon}</div><div class="upgrade-info"><div class="upgrade-name">${u.name}${isNew?' <span style="color:#4ade80;font-size:11px">NEW</span>':''}</div><div class="upgrade-desc">${u.desc}</div><div class="upgrade-level">${isNew?`NEW — Max ${u.maxLevel}`:`Level ${lvl+1}/${u.maxLevel}`}</div></div>`;
    card.addEventListener('click',()=>applyUpgrade(u.id));
    card.addEventListener('touchend',e=>{e.preventDefault();applyUpgrade(u.id);});
    container.appendChild(card);
  });
  panel.style.display='flex';
}

// ─── Game Loop ──────────────────────────────
let lastTime=0;
function gameLoop(time) {
  const dt=Math.min((time-lastTime)/1000,0.05);
  lastTime=time;
  if(!G.gameOver&&!G.paused){
    G.survivalTime+=dt;
    updateShake(dt);
    updateCamera(dt);
    updateWave(dt);
    updatePlayer(dt);
    updateEnemies(dt);
    updateEnemyProjectiles(dt);
    updateFireTrails(dt);
    updateProjectiles(dt);
    updateGates(dt);
    updateXP(dt);
    updateParticles(dt);
    updateFloatingTexts(dt);
    updateDamageNumbers(dt);
  }
  render();
  requestAnimationFrame(gameLoop);
}

// ─── Game Over ──────────────────────────────
function gameOver() {
  G.gameOver=true; sfx('gameover');
  setTimeout(()=>{
    G.canvas.addEventListener('click',restartGame,{once:true});
    G.canvas.addEventListener('touchstart',restartGame,{once:true});
  },800);
}
function restartGame(){resetGame();lastTime=performance.now();}

// ─── Init ────────────────────────────────────
function handleResize() {
  const canvas=G.canvas;
  const container=document.getElementById('canvas-container');
  if (!container) return;
  const rect=container.getBoundingClientRect();
  const dpr=window.devicePixelRatio||1;
  canvas.width=rect.width*dpr; canvas.height=rect.height*dpr;
  canvas.style.width=rect.width+'px'; canvas.style.height=rect.height+'px';
  G.W=rect.width; G.H=rect.height;
}

function initGame() {
  G.canvas=document.getElementById('game-canvas');
  if (!G.canvas) return;
  G.ctx=G.canvas.getContext('2d');
  window.addEventListener('resize',handleResize);
  handleResize();
  setupInput();
  resetGame();
  lastTime=performance.now();
  requestAnimationFrame(gameLoop);
}

document.addEventListener('DOMContentLoaded',initGame);

// ─── Test surface ─────────────────────────────
// Expose state and functions on window for Playwright/integration tests.
// `const`/`let` at module top level don't attach to window in browsers, so we
// re-export explicitly. This block has no runtime cost in normal play.
if (typeof window !== 'undefined') {
  window.G = G;
  window.UPGRADES = UPGRADES;
  window.ENEMY_TYPES = ENEMY_TYPES;
  window.WORLD_W = WORLD_W;
  window.WORLD_H = WORLD_H;
  window.availableEnemies = availableEnemies;
  window.makeEnemy = makeEnemy;
  window.enemyDeath = enemyDeath;
  window.applyUpgrade = applyUpgrade;
  window.collectXP = collectXP;
  window.levelUp = levelUp;
  window.updatePlayer = updatePlayer;
  window.updateEnemies = updateEnemies;
  window.updateEnemyProjectiles = updateEnemyProjectiles;
  window.updateFireTrails = updateFireTrails;
  window.updateProjectiles = updateProjectiles;
  window.updateXP = updateXP;
  window.updateGates = updateGates;
  window.generateGates = generateGates;
  window.spawnGate = spawnGate;
  window.gateValue = gateValue;
  window.updateParticles = updateParticles;
  window.updateFloatingTexts = updateFloatingTexts;
  window.updateDamageNumbers = updateDamageNumbers;
  window.updateShake = updateShake;
  window.updateWave = updateWave;
  window.updateCamera = updateCamera;
  window.updateEnemyBehavior = updateEnemyBehavior;
  window.fireProjectile = fireProjectile;
  window.render = render;
  window.renderHUD = renderHUD;
  window.renderMinimap = renderMinimap;
  window.renderUpgradePanel = renderUpgradePanel;
  window.gameLoop = gameLoop;
  window.gameOver = gameOver;
  window.restartGame = restartGame;
  window.handleResize = handleResize;
  window.onGyro = onGyro;
  window.addParticle = addParticle;
  window.showFloatingText = showFloatingText;
}
