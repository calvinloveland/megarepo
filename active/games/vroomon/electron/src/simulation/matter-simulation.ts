import Matter, { type Body, type Constraint, type Engine, type IChamferableBodyDefinition } from "matter-js";

import {
  decodeDnaV2,
  wheelDriveForIndex,
  type DecodedDnaV2,
  type WheelParams,
} from "../shared/dna-v2.js";
import { framePlant } from "../shared/frame.js";
import {
  getTerrainPreset,
  type TerrainPresetDefinition,
} from "../shared/parity-contract.js";

export interface BodySnapshot {
  x: number;
  y: number;
  angle: number;
  shape: "circle" | "rectangle";
  radius?: number;
  width?: number;
  height?: number;
}

export interface VehicleSnapshot {
  chassis: BodySnapshot[];
  wheels: BodySnapshot[];
  centerX: number;
  centerY: number;
}

/** A wheel the power path reaches: where it sits and how hard it pushes. */
export interface WheelDrive {
  index: number;
  offsetX: number;
  offsetY: number;
  radius: number;
  power: number;
  friction: number;
}

/**
 * The physics knobs worth arguing about. The design's bargain is that most
 * combinations don't work but some do, and that a dud stays tame — how far a
 * car gets should be a property of its own DNA, not of the solver throwing
 * it. One object, so tuning is one edit and can be measured.
 */
export const SIM_TUNING = {
  /** Hard ceiling on body speed (px/s), so no frame can fire a car away. */
  maxSpeed: 1600,
  /** Rims start this far below the ground line and settle onto it. */
  wheelSpawnClearance: 6,
  /**
   * Matter resolves penetration by moving bodies directly with a tolerance of
   * a fraction of a pixel, so a wheel that dips a hair into the dirt gets
   * shoved out hard enough to toss the car. Give vehicle bodies some slop.
   */
  vehicleSlop: 2,
  /** Solver passes per frame (Matter's defaults are 6/4). */
  positionIterations: 12,
  velocityIterations: 10,
  constraintIterations: 4,
  /** How much velocity a rolled-back step keeps. */
  rollbackVelocityScale: 0.25,
  /** How thick the floor is: nobody tunnels through a deep one. */
  groundThickness: 400,
  /** How much a plate out of line costs (sum of tilts in degrees / 90). */
  tiltCost: 3,
  /** And how much it costs to have the hull riding below its own wheels. */
  hullCost: 4,
  /** Drive force per unit of power actually delivered to a wheel. */
  forcePerPower: 0.00045,
  /** And the top speed that power can hold, in px/s per unit of power. */
  terminalSpeedPerPower: 0.9,
  /** The mass at which that top speed counts as unencumbered. */
  referenceMass: 1,
};

/** Milliseconds in one physics step at the game's frame rate. */
const STEP_MS = 1000 / 60;

const TERRAIN_OBSTACLE_START_X = 1600;
const TERRAIN_OBSTACLE_SPACING = 500;

export interface MatterVehicle {
  engine: Engine;
  terrain: TerrainPresetDefinition;
  decoded: DecodedDnaV2;
  terrainBodies: Body[];
  /** The one rigid body: every plate and every wheel is a part of it. */
  chassisBodies: Body[];
  /** The circle parts, in chain order. */
  wheelBodies: Body[];
  /** Always empty: a rigid vehicle needs no joints. */
  constraints: Constraint[];
  /**
   * What the frame lets the powertrain actually do: 1 for a tidy arch riding
   * on driven wheels, toward 0 for a folded run of plates that drags.
   */
  driveScale: number;
  /** The power path, wheel by wheel: where each sits and how hard it pushes. */
  wheelDriveBodies: WheelDrive[];
}

export interface RaceVehicleSnapshot extends VehicleSnapshot {
  id: string;
  dna: string;
  initialCenterX: number;
  initialCenterY: number;
  finalCenterX: number;
  finalCenterY: number;
}

export interface RaceVehicleFrameSnapshot extends VehicleSnapshot {
  id: string;
  dna: string;
  initialCenterX: number;
  initialCenterY: number;
}

export interface VehiclePreviewFrame {
  elapsedMs: number;
  snapshot: VehicleSnapshot;
}

export interface RacePreviewFrame {
  elapsedMs: number;
  vehicles: RaceVehicleFrameSnapshot[];
}

export interface RaceVehicleDefinition {
  id: string;
  dna: string;
}

export interface MatterRace {
  engine: Engine;
  terrain: TerrainPresetDefinition;
  terrainBodies: Body[];
  vehicles: Array<
    MatterVehicle & {
      id: string;
      dna: string;
      initialSnapshot: VehicleSnapshot;
    }
  >;
}

declare module "matter-js" {
  interface Body {
    /** The true rectangle of a plate part (see snapshotBody). */
    vroomonSize?: { width: number; height: number };
  }
}

const GROUND_COLLISION_CATEGORY = 0x0001;
const VEHICLE_COLLISION_CATEGORY = 0x0002;
const { Bodies, Body: MatterBody, Composite, Constraint: MatterConstraint, Engine: MatterEngine } = Matter;

export function createMatterVehicle(
  dna: string,
  terrainName = "Grassland",
  options?: { grip?: number; drive?: number },
): MatterVehicle {
  const terrain = getTerrainPreset(terrainName);

  if (!terrain) {
    throw new Error(`Unknown terrain preset: ${terrainName}`);
  }

  const engine = createEngine();
  const decoded = decodeDnaV2(dna);
  const terrainBodies = buildTerrainBodies(terrain);
  const { chassisBodies, wheelBodies, constraints, wheelDriveBodies, driveScale } =
    buildVehicleBodies(decoded, 220, terrain.groundHeight, {
      grip: options?.grip ?? 1,
      drive: options?.drive ?? 1,
    });

  Composite.add(engine.world, [
    ...terrainBodies,
    ...chassisBodies,
    ...wheelBodies,
    ...constraints,
  ]);

  return {
    engine,
    terrain,
    decoded,
    terrainBodies,
    chassisBodies,
    wheelBodies,
    constraints,
    wheelDriveBodies,
    driveScale,
  };
}

export function createMatterRace(
  vehicles: RaceVehicleDefinition[],
  terrainName = "Grassland",
): MatterRace {
  const terrain = getTerrainPreset(terrainName);

  if (!terrain) {
    throw new Error(`Unknown terrain preset: ${terrainName}`);
  }

  const terrainBodies = buildTerrainBodies(terrain);
  const engine = createEngine();
  Composite.add(engine.world, terrainBodies);

  const raceVehicles = vehicles.map((vehicle, index) => {
    const decoded = decodeDnaV2(vehicle.dna);
    const builtVehicle = buildVehicleBodies(
      decoded,
      220 + index * 150,
      terrain.groundHeight,
    );
    Composite.add(engine.world, [
      ...builtVehicle.chassisBodies,
      ...builtVehicle.wheelBodies,
      ...builtVehicle.constraints,
    ]);

    const matterVehicle = {
      engine,
      terrain,
      decoded,
      terrainBodies,
      chassisBodies: builtVehicle.chassisBodies,
      wheelBodies: builtVehicle.wheelBodies,
      constraints: builtVehicle.constraints,
      wheelDriveBodies: builtVehicle.wheelDriveBodies,
      driveScale: builtVehicle.driveScale,
      id: vehicle.id,
      dna: vehicle.dna,
      initialSnapshot: snapshotVehicleBodies(
        builtVehicle.chassisBodies,
        builtVehicle.wheelBodies,
      ),
    };

    return matterVehicle;
  });

  return {
    engine,
    terrain,
    terrainBodies,
    vehicles: raceVehicles,
  };
}

export function stepMatterVehicle(
  vehicle: MatterVehicle,
  stepCount = 180,
  deltaMs = 1000 / 60,
): VehicleSnapshot {
  for (let index = 0; index < stepCount; index += 1) {
    applyWheelDrive(vehicle);
    clampVehicleSpeeds(vehicle);
    const before = capturePositions(vehicle);
    MatterEngine.update(vehicle.engine, deltaMs);
    clampStepTravel(vehicle, before, deltaMs);
  }

  return snapshotMatterVehicle(vehicle);
}

export function simulateMatterVehicleFrames(
  dna: string,
  terrainName = "Grassland",
  options?: {
    stepCount?: number;
    deltaMs?: number;
    frameCount?: number;
    grip?: number;
    drive?: number;
  },
): VehiclePreviewFrame[] {
  const vehicle = createMatterVehicle(dna, terrainName, {
    grip: options?.grip,
    drive: options?.drive,
  });
  const stepCount = options?.stepCount ?? 180;
  const deltaMs = options?.deltaMs ?? 1000 / 60;
  const frameCount = Math.max(2, options?.frameCount ?? 24);
  const captureEvery = Math.max(1, Math.floor(stepCount / (frameCount - 1)));
  const frames: VehiclePreviewFrame[] = [
    {
      elapsedMs: 0,
      snapshot: snapshotMatterVehicle(vehicle),
    },
  ];

  for (let index = 0; index < stepCount; index += 1) {
    applyWheelDrive(vehicle);
    clampVehicleSpeeds(vehicle);
    const before = capturePositions(vehicle);
    MatterEngine.update(vehicle.engine, deltaMs);
    clampStepTravel(vehicle, before, deltaMs);

    if ((index + 1) % captureEvery === 0 || index === stepCount - 1) {
      frames.push({
        elapsedMs: (index + 1) * deltaMs,
        snapshot: snapshotMatterVehicle(vehicle),
      });
    }
  }

  return frames;
}

export function simulatePopulationRace(
  vehicles: RaceVehicleDefinition[],
  terrainName = "Grassland",
  options?: {
    stepCount?: number;
    deltaMs?: number;
  },
): RaceVehicleSnapshot[] {
  const race = createMatterRace(vehicles, terrainName);
  const stepCount = options?.stepCount ?? 180;
  const deltaMs = options?.deltaMs ?? 1000 / 60;

  for (let index = 0; index < stepCount; index += 1) {
    for (const vehicle of race.vehicles) {
      applyWheelDrive(vehicle);
      clampVehicleSpeeds(vehicle);
    }
    const before = race.vehicles.map((vehicle) => capturePositions(vehicle));
    MatterEngine.update(race.engine, deltaMs);
    race.vehicles.forEach((vehicle, index) =>
      clampStepTravel(vehicle, before[index]!, deltaMs),
    );
  }

  return race.vehicles.map((vehicle) => {
    const snapshot = snapshotMatterVehicle(vehicle);

    return {
      id: vehicle.id,
      dna: vehicle.dna,
      ...snapshot,
      initialCenterX: vehicle.initialSnapshot.centerX,
      initialCenterY: vehicle.initialSnapshot.centerY,
      finalCenterX: snapshot.centerX,
      finalCenterY: snapshot.centerY,
    };
  });
}

export function simulatePopulationRaceFrames(
  vehicles: RaceVehicleDefinition[],
  terrainName = "Grassland",
  options?: {
    stepCount?: number;
    deltaMs?: number;
    frameCount?: number;
  },
): RacePreviewFrame[] {
  const race = createMatterRace(vehicles, terrainName);
  const stepCount = options?.stepCount ?? 180;
  const deltaMs = options?.deltaMs ?? 1000 / 60;
  const frameCount = Math.max(2, options?.frameCount ?? 24);
  const captureEvery = Math.max(1, Math.floor(stepCount / (frameCount - 1)));
  const frames: RacePreviewFrame[] = [
    {
      elapsedMs: 0,
      vehicles: snapshotRaceVehicles(race),
    },
  ];

  for (let index = 0; index < stepCount; index += 1) {
    for (const vehicle of race.vehicles) {
      applyWheelDrive(vehicle);
      clampVehicleSpeeds(vehicle);
    }
    const before = race.vehicles.map((vehicle) => capturePositions(vehicle));
    MatterEngine.update(race.engine, deltaMs);
    race.vehicles.forEach((vehicle, index) =>
      clampStepTravel(vehicle, before[index]!, deltaMs),
    );

    if ((index + 1) % captureEvery === 0 || index === stepCount - 1) {
      frames.push({
        elapsedMs: (index + 1) * deltaMs,
        vehicles: snapshotRaceVehicles(race),
      });
    }
  }

  return frames;
}

/**
 * The pieces to draw: a rigid vehicle is one compound body, so expand it into
 * its parts — rectangles are plates, circles are wheels.
 */
function snapshotState(chassisBodies: Body[], wheelBodies: Body[]): VehicleSnapshot {
  const pieces = new Set<Body>();
  for (const body of chassisBodies) {
    const parts = (body as unknown as { parts?: Body[] }).parts ?? [];
    if (parts.length > 1) {
      for (const part of parts.slice(1)) {
        pieces.add(part);
      }
    } else {
      pieces.add(body);
    }
  }
  for (const wheel of wheelBodies) {
    pieces.add(wheel);
  }

  const isCircle = (body: Body): boolean =>
    typeof body.circleRadius === "number" && body.circleRadius > 0;
  const all = [...pieces];
  const chassis = all.filter((body) => !isCircle(body)).map(snapshotBody);
  const wheels = all.filter(isCircle).map(snapshotBody);
  const centerX =
    all.reduce((sum, body) => sum + body.position.x, 0) / Math.max(all.length, 1);
  const centerY =
    all.reduce((sum, body) => sum + body.position.y, 0) / Math.max(all.length, 1);

  return { chassis, wheels, centerX, centerY };
}

export function snapshotMatterVehicle(vehicle: MatterVehicle): VehicleSnapshot {
  return snapshotState(vehicle.chassisBodies, vehicle.wheelBodies);
}

function buildTerrainBodies(terrain: TerrainPresetDefinition): Body[] {
  const ground = Bodies.rectangle(
    terrain.groundLength / 2,
    terrain.groundHeight + SIM_TUNING.groundThickness / 2,
    terrain.groundLength,
    SIM_TUNING.groundThickness,
    {
      isStatic: true,
      friction: terrain.friction,
      collisionFilter: {
        category: GROUND_COLLISION_CATEGORY,
        mask: VEHICLE_COLLISION_CATEGORY,
      },
    },
  );
  const bodies = [ground];

  if (
    terrain.obstacleCount > 0 &&
    terrain.obstacleWidth &&
    terrain.obstacleHeightBase !== undefined &&
    terrain.obstacleHeightStep !== undefined
  ) {
    for (let index = 0; index < terrain.obstacleCount; index += 1) {
      const height =
        terrain.obstacleHeightBase + terrain.obstacleHeightStep * index;
      bodies.push(
        Bodies.rectangle(
          // The first obstacle sits past the longest chain (a 12-module body
          // is around 1000px long), otherwise long cars spawn inside an
          // obstacle and the solver fires them off the track.
          TERRAIN_OBSTACLE_START_X + index * TERRAIN_OBSTACLE_SPACING,
          terrain.groundHeight - height / 2,
          terrain.obstacleWidth,
          height,
          {
            isStatic: true,
            friction: terrain.friction,
            collisionFilter: {
              category: GROUND_COLLISION_CATEGORY,
              mask: VEHICLE_COLLISION_CATEGORY,
            },
          },
        ),
      );
    }
  }

  return bodies;
}

function buildVehicleBodies(
  decoded: DecodedDnaV2,
  originX: number,
  groundY: number,
  weather: { grip: number; drive: number } = { grip: 1, drive: 1 },
): {
  chassisBodies: Body[];
  wheelBodies: Body[];
  constraints: Constraint[];
  wheelDriveBodies: WheelDrive[];
  driveScale: number;
} {
  const collisionFilter = {
    category: VEHICLE_COLLISION_CATEGORY,
    mask: GROUND_COLLISION_CATEGORY,
  };

  // ---- Structure path ----
  // A tilted plate drops its corners, so the hull's lowest point says how
  // high to sit: an arch of plates rides high on its wheels, a folded run of
  // them drags. That single number is what makes "weird angle" cost, and it
  // comes from the shared frame maths so the inspector reports the same car.
  const plant = framePlant(decoded, {
    tiltCost: SIM_TUNING.tiltCost,
    hullCost: SIM_TUNING.hullCost,
  });
  const plateDrop = plant.plateDrop;
  const spawnY = groundY - 3 - plateDrop;

  const parts: Body[] = [];
  const wheelParts: Body[] = [];
  const wheelDrives: WheelDrive[] = [];
  const hasStructure = decoded.modules.includes("R");

  for (const [index, module] of decoded.modules.entries()) {
    const x = originX + decoded.positions[index]!;

    if (module === "R") {
      const rectangle = decoded.rectParams[index];
      if (!rectangle) {
        continue;
      }
      const plate = Bodies.rectangle(x, spawnY, rectangle.width, rectangle.height, {
        density: rectangle.density * 0.001,
        angle: (rectangle.angleDeg * Math.PI) / 180,
        chamfer: { radius: 3 },
        slop: SIM_TUNING.vehicleSlop,
        collisionFilter,
      } satisfies IChamferableBodyDefinition);
      // Remember the true rectangle: a chamfered plate has a dozen vertices,
      // so its shape cannot be recovered from them, and its bounding box is
      // wider than the plate once it is tilted.
      plate.vroomonSize = { width: rectangle.width, height: rectangle.height };
      parts.push(plate);
      continue;
    }

    const wheel = decoded.wheelParams[index];
    if (!wheel) {
      continue;
    }
    // Rims settle onto the ground from just below it, rather than starting in
    // contact: a body that spawns touching a surface is one the solver may
    // resolve by shoving it away.
    const wheelY = spawnY + plateDrop + 3 - wheel.radius - SIM_TUNING.wheelSpawnClearance;
    const wheelPart = Bodies.circle(x, wheelY, wheel.radius, {
      density: 0.0006,
      // Weather cuts the grip a wheel can put down; the ground is the same.
      friction: wheel.friction * weather.grip,
      frictionAir: decoded.globals.dampingAngular,
      slop: SIM_TUNING.vehicleSlop,
      collisionFilter,
    });
    parts.push(wheelPart);
    wheelParts.push(wheelPart);

    // A wheel with no cylinder upstream is along for the ride.
    const drive = wheelDriveForIndex(decoded, index);
    wheelDrives.push({
      index,
      offsetX: x,
      offsetY: wheelY,
      radius: wheel.radius,
      power: hasStructure ? drive.power * weather.drive : 0,
      friction: wheel.friction,
    });
  }

  // ---- One rigid body ----
  // Every plate and every wheel is a part of the SAME body: a frame with
  // wheels joined at their centres. Holding separate wheel bodies on pins
  // asked the solver to keep a car together every frame, and it resolved that
  // by throwing cars off the ground instead.
  const chassis =
    parts.length > 0
      ? MatterBody.create({
          parts,
          frictionAir: decoded.globals.dampingLinear,
          slop: SIM_TUNING.vehicleSlop,
          collisionFilter,
        })
      : null;

  if (chassis) {
    // Drive is applied AT the wheel that delivers it, so where a driven wheel
    // sits along the chain changes how the car behaves.
    for (const drive of wheelDrives) {
      drive.offsetX -= chassis.position.x;
      drive.offsetY -= chassis.position.y;
    }
  }

  const driveScale = plant.driveScale;

  return {
    chassisBodies: chassis ? [chassis] : [],
    wheelBodies: wheelParts,
    constraints: [],
    wheelDriveBodies: wheelDrives,
    driveScale,
  };
}

function snapshotBody(body: Body): BodySnapshot {
  const isCircle = typeof body.circleRadius === "number" && body.circleRadius > 0;
  if (isCircle) {
    return {
      x: body.position.x,
      y: body.position.y,
      angle: body.angle,
      shape: "circle",
      radius: body.circleRadius ?? undefined,
    };
  }

  // The TRUE rectangle, remembered when the plate was built. Measuring the
  // vertices does not work (a chamfered plate has a dozen of them) and the
  // bounding box reports a tilted plate as wider than it is, which draws
  // plates that miss their neighbours.
  const size = body.vroomonSize;
  const width = size?.width ?? body.bounds.max.x - body.bounds.min.x;
  const height = size?.height ?? body.bounds.max.y - body.bounds.min.y;

  return {
    x: body.position.x,
    y: body.position.y,
    angle: body.angle,
    shape: "rectangle",
    width,
    height,
  };
}

function snapshotVehicleBodies(
  chassisBodies: Body[],
  wheelBodies: Body[],
): VehicleSnapshot {
  return snapshotState(chassisBodies, wheelBodies);
}

function snapshotRaceVehicles(race: MatterRace): RaceVehicleFrameSnapshot[] {
  return race.vehicles.map((vehicle) => {
    const snapshot = snapshotMatterVehicle(vehicle);

    return {
      id: vehicle.id,
      dna: vehicle.dna,
      initialCenterX: vehicle.initialSnapshot.centerX,
      initialCenterY: vehicle.initialSnapshot.centerY,
      ...snapshot,
    };
  });
}

function createEngine(): Engine {
  return MatterEngine.create({
    gravity: { x: 0, y: 1, scale: 0.0012 },
    // More solver passes than the defaults: a vehicle is a body resting on
    // the ground with a lot of parts, and a half-solved frame is what makes
    // bodies pop off the surface.
    positionIterations: SIM_TUNING.positionIterations,
    velocityIterations: SIM_TUNING.velocityIterations,
    constraintIterations: SIM_TUNING.constraintIterations,
  });
}

/**
 * Drive the rigid body with forces applied at each wheel the power path
 * reaches. The legacy prototype spun wheel bodies with a SimpleMotor and a
 * torque ceiling; the equivalent for one rigid body is a force at that
 * wheel's own position, capped by the speed its power can hold — so more
 * engines means a faster car, a heavy frame accelerates slower, and a force
 * applied off-centre pitches the car the way real drive does.
 */
function applyWheelDrive(vehicle: MatterVehicle): void {
  const body = vehicle.chassisBodies[0];
  if (!body || vehicle.driveScale <= 0) {
    return;
  }
  const drives = vehicle.wheelDriveBodies.filter((drive) => drive.power > 0);
  if (drives.length === 0) {
    return; // nothing reaches a wheel: the car only moves if the ground does
  }

  const direction = Math.cos(body.angle) >= 0 ? 1 : -1;
  // Matter works in pixels per STEP; the tuning is in pixels per SECOND, so
  // the comparison has to be converted or the limit does nothing at all.
  const forwardSpeed = body.velocity.x * (1000 / STEP_MS) * direction;
  const totalPower = drives.reduce((sum, drive) => sum + drive.power, 0);
  // Power has to move the steel it is bolted to: the same engine in a heavier
  // frame holds a lower speed.
  const heft = Math.max(0.6, Math.sqrt(body.mass / SIM_TUNING.referenceMass));
  const terminalSpeed = Math.min(
    SIM_TUNING.maxSpeed * 0.7,
    (totalPower * SIM_TUNING.terminalSpeedPerPower) / heft,
  );
  const headroom = clampNumber(1 - forwardSpeed / Math.max(terminalSpeed, 1), 0, 1);
  if (headroom <= 0) {
    return; // already at the speed this powertrain can hold
  }

  for (const drive of drives) {
    const share = drive.power / totalPower;
    const offset = { x: drive.offsetX * direction, y: drive.offsetY };
    const point = {
      x: body.position.x + offset.x * Math.cos(body.angle) - offset.y * Math.sin(body.angle),
      y: body.position.y + offset.x * Math.sin(body.angle) + offset.y * Math.cos(body.angle),
    };
    MatterBody.applyForce(body, point, {
      x:
        drive.power *
        share *
        SIM_TUNING.forcePerPower *
        headroom *
        vehicle.driveScale *
        direction,
      y: 0,
    });
  }
}

function clampVehicleSpeeds(vehicle: MatterVehicle): void {
  if (vehicle.chassisBodies.length === 0) {
    // Loose wheels are still parts of one body, but guard anyway.
    return;
  }
  for (const body of vehicle.chassisBodies) {
    // Velocity is per step; the ceiling is per second.
    const speed = Math.hypot(body.velocity.x, body.velocity.y) * (1000 / STEP_MS);
    if (speed > SIM_TUNING.maxSpeed) {
      const scale = SIM_TUNING.maxSpeed / speed;
      MatterBody.setVelocity(body, {
        x: body.velocity.x * scale,
        y: body.velocity.y * scale,
      });
    }
  }
}

type PositionSnapshot = Map<Body, { x: number; y: number }>;

function capturePositions(vehicle: MatterVehicle): PositionSnapshot {
  const snapshot: PositionSnapshot = new Map();
  for (const body of [...vehicle.chassisBodies, ...vehicle.wheelBodies]) {
    snapshot.set(body, { x: body.position.x, y: body.position.y });
  }
  return snapshot;
}

/**
 * A hard ceiling on how far a body may travel in one step. Matter resolves
 * interpenetration by moving bodies directly, which no velocity limit can
 * catch — so a badly spawned or badly landed car could be thrown into orbit.
 * A step that breaks the ceiling is rolled back whole, because clamping it
 * part-way could still leave a body half through the floor.
 */
function clampStepTravel(
  vehicle: MatterVehicle,
  before: PositionSnapshot,
  deltaMs: number,
): void {
  // 25% headroom over the top speed, so honest fast motion is never touched
  // and only outright teleports get pulled back.
  const maxTravel = ((SIM_TUNING.maxSpeed * deltaMs) / 1000) * 1.25;
  for (const [body, start] of before) {
    const dx = body.position.x - start.x;
    const dy = body.position.y - start.y;
    if (Math.hypot(dx, dy) <= maxTravel) {
      continue;
    }
    MatterBody.setPosition(body, { x: start.x, y: start.y });
    MatterBody.setVelocity(body, {
      x: body.velocity.x * SIM_TUNING.rollbackVelocityScale,
      y: body.velocity.y * SIM_TUNING.rollbackVelocityScale,
    });
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
