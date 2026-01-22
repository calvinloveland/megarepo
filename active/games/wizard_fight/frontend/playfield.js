import * as PIXI from "https://cdn.jsdelivr.net/npm/pixi.js@7.4.2/dist/pixi.min.mjs";

const DEFAULT_COLORS = {
  background: 0x0f111a,
  lane: 0x15182a,
  laneBorder: 0x2c3150,
  water: 0x1f4f8f,
  path: 0x2c3150,
  mountains: 0x20233a,
  wizardLeft: 0x7f8cff,
  wizardRight: 0xffa36d,
};

export function createPlayfield(container, options = {}) {
  const colors = { ...DEFAULT_COLORS, ...(options.colors || {}) };
  const app = new PIXI.Application({
    width: container.clientWidth || 960,
    height: options.height || 420,
    backgroundColor: colors.background,
    antialias: true,
  });

  container.innerHTML = "";
  container.appendChild(app.view);

  const layerBackground = new PIXI.Container();
  const layerUnits = new PIXI.Container();
  const layerDecor = new PIXI.Container();
  const layerEffects = new PIXI.Container();
  const layerImpacts = new PIXI.Container();
  app.stage.addChild(layerBackground, layerDecor, layerEffects, layerImpacts, layerUnits);

  const unitSprites = new Map();
  const unitTargets = new Map();
  const impactSprites = [];
  const lastWizardHealth = { 0: null, 1: null };
  let lastConfig = { arena_length: 100, lane_count: 3 };

  function resize() {
    const width = container.clientWidth || 960;
    const height = options.height || 420;
    app.renderer.resize(width, height);
    renderBackground(lastConfig);
  }

  function renderBackground(config) {
    lastConfig = config || lastConfig;
    const laneCount = lastConfig.lane_count || 3;
    const width = app.renderer.width;
    const height = app.renderer.height;
    const laneHeight = Math.max(90, Math.floor(height / laneCount));

    layerBackground.removeChildren();
    layerDecor.removeChildren();

    for (let lane = 0; lane < laneCount; lane += 1) {
      const laneTop = lane * laneHeight;
      const laneRect = new PIXI.Graphics();
      laneRect.beginFill(colors.lane);
      laneRect.drawRoundedRect(0, laneTop + 6, width, laneHeight - 12, 12);
      laneRect.endFill();
      laneRect.lineStyle(1, colors.laneBorder, 0.8);
      laneRect.moveTo(0, laneTop + laneHeight / 2);
      laneRect.lineTo(width, laneTop + laneHeight / 2);
      layerBackground.addChild(laneRect);

      if (lane === Math.floor(laneCount / 2)) {
        const water = new PIXI.Graphics();
        water.beginFill(colors.water, 0.55);
        water.drawRoundedRect(width * 0.15, laneTop + laneHeight * 0.25, width * 0.7, laneHeight * 0.5, 18);
        water.endFill();
        layerDecor.addChild(water);
      } else {
        const mountain = new PIXI.Graphics();
        mountain.beginFill(colors.mountains, 0.45);
        mountain.drawPolygon([
          width * 0.1, laneTop + laneHeight * 0.8,
          width * 0.25, laneTop + laneHeight * 0.2,
          width * 0.4, laneTop + laneHeight * 0.8,
          width * 0.55, laneTop + laneHeight * 0.25,
          width * 0.7, laneTop + laneHeight * 0.8,
          width * 0.9, laneTop + laneHeight * 0.35,
          width * 0.95, laneTop + laneHeight * 0.8,
        ]);
        mountain.endFill();
        layerDecor.addChild(mountain);

        const path = new PIXI.Graphics();
        path.lineStyle(4, colors.path, 0.7);
        path.moveTo(width * 0.05, laneTop + laneHeight * 0.65);
        path.bezierCurveTo(
          width * 0.25,
          laneTop + laneHeight * 0.45,
          width * 0.45,
          laneTop + laneHeight * 0.75,
          width * 0.75,
          laneTop + laneHeight * 0.45
        );
        path.lineTo(width * 0.95, laneTop + laneHeight * 0.55);
        layerDecor.addChild(path);
      }

    }

    const middleLane = Math.floor(laneCount / 2);
    const wizardY = middleLane * laneHeight + laneHeight * 0.5 - 12;
    const wizardLeft = new PIXI.Text("🧙‍♂️", { fontSize: 24 });
    wizardLeft.x = 18;
    wizardLeft.y = wizardY;
    wizardLeft.tint = colors.wizardLeft;
    layerDecor.addChild(wizardLeft);

    const wizardRight = new PIXI.Text("🧙‍♀️", { fontSize: 24 });
    wizardRight.x = width - 34;
    wizardRight.y = wizardY;
    wizardRight.tint = colors.wizardRight;
    layerDecor.addChild(wizardRight);
  }

  function unitSprite(unit) {
    const icon = unit.emoji || (unit.owner_id === 0 ? "🐒" : "🐵");
    const text = new PIXI.Text(icon, { fontSize: 18 });
    text.anchor.set(0.5, 0.5);
    return text;
  }

  function effectIcon(effectType) {
    const table = {
      fog: "🌫️",
      wind: "💨",
      gravity: "🌀",
      buff: "✨",
      debuff: "☠️",
      burn: "🔥",
      shield: "🛡️",
    };
    return table[effectType] || "🔮";
  }

  function addImpact(icon, x, y) {
    const sprite = new PIXI.Text(icon, { fontSize: 20 });
    sprite.anchor.set(0.5, 0.5);
    sprite.x = x;
    sprite.y = y;
    layerImpacts.addChild(sprite);
    impactSprites.push({ sprite, life: 0.8, drift: (Math.random() - 0.5) * 8 });
  }

  function render(state) {
    if (!state) return;
    const config = state.config || lastConfig;
    renderBackground(config);

    const width = app.renderer.width;
    const height = app.renderer.height;
    const laneCount = config.lane_count || 3;
    const laneHeight = Math.max(90, Math.floor(height / laneCount));
    const arenaLength = config.arena_length || 100;

    layerEffects.removeChildren();
    (state.environment || []).forEach((effect, idx) => {
      const lane = Number.isFinite(effect.lane_id)
        ? effect.lane_id
        : Math.floor(laneCount / 2);
      const laneTop = lane * laneHeight;
      const icon = effectIcon(effect.type);
      const sprite = new PIXI.Text(icon, { fontSize: 20 });
      sprite.anchor.set(0.5, 0.5);
      sprite.x = width * 0.5 + (idx % 3) * 26 - 26;
      sprite.y = laneTop + laneHeight * 0.35 + (idx % 2) * 10;
      const duration = Number(effect.remaining_duration || 0);
      sprite.alpha = Math.min(1, Math.max(0.3, duration / 6));
      layerEffects.addChild(sprite);
    });

    const middleLane = Math.floor(laneCount / 2);
    const wizardY = middleLane * laneHeight + laneHeight * 0.5 - 12;
    const w0 = state.wizards?.[0];
    const w1 = state.wizards?.[1];
    if (w0 && lastWizardHealth[0] !== null && w0.health < lastWizardHealth[0] - 0.1) {
      addImpact("💥", 28, wizardY);
    }
    if (w1 && lastWizardHealth[1] !== null && w1.health < lastWizardHealth[1] - 0.1) {
      addImpact("💥", width - 28, wizardY);
    }
    if (w0) lastWizardHealth[0] = w0.health;
    if (w1) lastWizardHealth[1] = w1.health;

    const nextIds = new Set();
    (state.units || []).forEach((unit) => {
      nextIds.add(unit.unit_id);
      let sprite = unitSprites.get(unit.unit_id);
      if (!sprite) {
        sprite = unitSprite(unit);
        unitSprites.set(unit.unit_id, sprite);
        layerUnits.addChild(sprite);
      }
      const lane = Number.isFinite(unit.lane) ? unit.lane : Math.floor(laneCount / 2);
      const laneTop = lane * laneHeight;
      const ratio = unit.position / arenaLength;
      const targetX = 60 + ratio * (width - 120);
      const targetY = laneTop + laneHeight * 0.5;
      if (!unitTargets.has(unit.unit_id)) {
        sprite.x = targetX;
        sprite.y = targetY;
      }
      unitTargets.set(unit.unit_id, { x: targetX, y: targetY });
    });

    for (const [unitId, sprite] of unitSprites.entries()) {
      if (!nextIds.has(unitId)) {
        layerUnits.removeChild(sprite);
        unitSprites.delete(unitId);
        unitTargets.delete(unitId);
      }
    }
  }

  renderBackground(lastConfig);
  app.ticker.add(() => {
    for (const [unitId, sprite] of unitSprites.entries()) {
      const target = unitTargets.get(unitId);
      if (!target) continue;
      sprite.x += (target.x - sprite.x) * 0.2;
      sprite.y += (target.y - sprite.y) * 0.2;
    }
    for (let i = impactSprites.length - 1; i >= 0; i -= 1) {
      const impact = impactSprites[i];
      impact.life -= app.ticker.deltaMS / 1000;
      impact.sprite.y -= 0.6;
      impact.sprite.x += impact.drift * 0.02;
      impact.sprite.alpha = Math.max(0, impact.life / 0.8);
      if (impact.life <= 0) {
        layerImpacts.removeChild(impact.sprite);
        impactSprites.splice(i, 1);
      }
    }
  });
  window.addEventListener("resize", resize);

  return {
    render,
    resize,
    destroy() {
      window.removeEventListener("resize", resize);
      app.destroy(true, { children: true });
    },
  };
}
