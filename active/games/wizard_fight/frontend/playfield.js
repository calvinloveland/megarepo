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
  app.stage.addChild(layerBackground, layerDecor, layerUnits);

  const unitSprites = new Map();
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

      const wizardLeft = new PIXI.Text("🧙‍♂️", { fontSize: 20 });
      wizardLeft.x = 12;
      wizardLeft.y = laneTop + laneHeight * 0.5 - 12;
      wizardLeft.tint = colors.wizardLeft;
      layerDecor.addChild(wizardLeft);

      const wizardRight = new PIXI.Text("🧙‍♀️", { fontSize: 20 });
      wizardRight.x = width - 28;
      wizardRight.y = laneTop + laneHeight * 0.5 - 12;
      wizardRight.tint = colors.wizardRight;
      layerDecor.addChild(wizardRight);
    }
  }

  function unitSprite(unit) {
    const icon = unit.owner_id === 0 ? "🐒" : "🐵";
    const text = new PIXI.Text(icon, { fontSize: 18 });
    text.anchor.set(0.5, 0.5);
    return text;
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
      sprite.x = 60 + ratio * (width - 120);
      sprite.y = laneTop + laneHeight * 0.5;
    });

    for (const [unitId, sprite] of unitSprites.entries()) {
      if (!nextIds.has(unitId)) {
        layerUnits.removeChild(sprite);
        unitSprites.delete(unitId);
      }
    }
  }

  renderBackground(lastConfig);
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
