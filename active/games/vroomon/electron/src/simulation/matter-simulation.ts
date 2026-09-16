import Matter, { type Body, type Constraint, type Engine, type IChamferableBodyDefinition } from "matter-js";

import {
  decodeDnaV2,
  wheelDriveForIndex,
  type DecodedDnaV2,
  type WheelParams,
} from "../shared/dna-v2.js";
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

export interface MatterVehicle {
  engine: Engine;
  terrain: TerrainPresetDefinition;
  decoded: DecodedDnaV2;
  terrainBodies: Body[];
  chassisBodies: Body[];
  wheelBodies: Body[];
  constraints: Constraint[];
  wheelDriveBodies: Array<{ wheel: Body; motorPower: number; friction: number }>;
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

const GROUND_COLLISION_CATEGORY = 0x0001;
const VEHICLE_COLLISION_CATEGORY = 0x0002;
const { Bodies, Body: MatterBody, Composite, Constraint: MatterConstraint, Engine: MatterEngine } = Matter;

export function createMatterVehicle(
  dna: string,
  terrainName = "Grassland",
): MatterVehicle {
  const terrain = getTerrainPreset(terrainName);

  if (!terrain) {
    throw new Error(`Unknown terrain preset: ${terrainName}`);
  }

  const engine = createEngine();
  const decoded = decodeDnaV2(dna);
  const terrainBodies = buildTerrainBodies(terrain);
  const { chassisBodies, wheelBodies, constraints, wheelDriveBodies } =
    buildVehicleBodies(decoded, 220, terrain.groundHeight);

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
    applyWheelDrive(vehicle.wheelDriveBodies);
    MatterEngine.update(vehicle.engine, deltaMs);
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
  },
): VehiclePreviewFrame[] {
  const vehicle = createMatterVehicle(dna, terrainName);
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
    applyWheelDrive(vehicle.wheelDriveBodies);
    MatterEngine.update(vehicle.engine, deltaMs);

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
      applyWheelDrive(vehicle.wheelDriveBodies);
    }
    MatterEngine.update(race.engine, deltaMs);
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
      applyWheelDrive(vehicle.wheelDriveBodies);
    }
    MatterEngine.update(race.engine, deltaMs);

    if ((index + 1) % captureEvery === 0 || index === stepCount - 1) {
      frames.push({
        elapsedMs: (index + 1) * deltaMs,
        vehicles: snapshotRaceVehicles(race),
      });
    }
  }

  return frames;
}

export function snapshotMatterVehicle(vehicle: MatterVehicle): VehicleSnapshot {
  // The chassis is a compound body: snapshot its PLATES (parts[0] is the
  // body itself, the rest are the attached rectangles) so the car draws as
  // the shape its DNA describes instead of one grey slab.
  const chassis = vehicle.chassisBodies.flatMap((body) => {
    const parts = (body as unknown as { parts?: Body[] }).parts ?? [];
    const plates = parts.length > 1 ? parts.slice(1) : [body];
    return plates.map(snapshotBody);
  });
  const wheels = vehicle.wheelBodies.map(snapshotBody);
  const allBodies = [...chassis, ...wheels];
  const centerX =
    allBodies.reduce((sum, body) => sum + body.x, 0) / Math.max(allBodies.length, 1);
  const centerY =
    allBodies.reduce((sum, body) => sum + body.y, 0) / Math.max(allBodies.length, 1);

  return {
    chassis,
    wheels,
    centerX,
    centerY,
  };
}

function buildTerrainBodies(terrain: TerrainPresetDefinition): Body[] {
  const ground = Bodies.rectangle(
    terrain.groundLength / 2,
    terrain.groundHeight + 40,
    terrain.groundLength,
    80,
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
          600 + index * 300,
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
): {
  chassisBodies: Body[];
  wheelBodies: Body[];
  constraints: Constraint[];
  wheelDriveBodies: Array<{ wheel: Body; motorPower: number; friction: number }>;
} {
  const wheelBodies: Body[] = [];
  const constraints: Constraint[] = [];
  const wheelDriveBodies: Array<{ wheel: Body; motorPower: number; friction: number }> = [];
  const collisionFilter = {
    category: VEHICLE_COLLISION_CATEGORY,
    mask: GROUND_COLLISION_CATEGORY,
  };

  // ---- Structure path: ONE rigid chassis ----
  // Every rectangle in the chain is a plate on the same compound body, so the
  // frame behaves like a frame. Plates keep their own tilt, which is what
  // makes a run of them an arch — or a folded mess that can't roll.
  // How far below the origin the lowest bit of the hull reaches: a tilted
  // plate drops its corner by half its width, so an arch sits high on its
  // wheels and a folded mess drags no matter what.
  const plateDrop =
    decoded.rectParams.filter(Boolean).length > 0
      ? Math.max(
          ...decoded.rectParams
            .filter((rectangle): rectangle is NonNullable<typeof rectangle> =>
              Boolean(rectangle),
            )
            .map((rectangle) => {
              const tilt = (Math.abs(rectangle.angleDeg) * Math.PI) / 180;
              return (
                (rectangle.height / 2) * Math.cos(tilt) +
                (rectangle.width / 2) * Math.sin(tilt)
              );
            }),
        )
      : 12;

  const plates: Body[] = [];
  const spawnY = groundY - 3 - plateDrop;
  for (const [index, module] of decoded.modules.entries()) {
    if (module !== "R") {
      continue;
    }
    const rectangle = decoded.rectParams[index];
    if (!rectangle) {
      continue;
    }
    plates.push(
      Bodies.rectangle(
        originX + decoded.positions[index]!,
        spawnY,
        rectangle.width,
        rectangle.height,
        {
          density: rectangle.density * 0.001,
          angle: (rectangle.angleDeg * Math.PI) / 180,
          chamfer: { radius: 3 },
          collisionFilter,
        } satisfies IChamferableBodyDefinition,
      ),
    );
  }

  const originY = spawnY;

  const chassis =
    plates.length > 0
      ? MatterBody.create({
          parts: plates,
          frictionAir: decoded.globals.dampingLinear,
          collisionFilter,
        })
      : null;

  // ---- Power path + wheels ----
  // Each wheel is its own body, pinned by a zero-length joint at its CENTRE
  // (the design's "join at the centre of the wheels"), and driven by whatever
  // the powertrain chain delivers to its index. A wheel with no cylinder
  // upstream gets no power and simply sits there.
  for (const [index, module] of decoded.modules.entries()) {
    if (module !== "W") {
      continue;
    }
    const wheel = decoded.wheelParams[index];
    if (!wheel) {
      continue;
    }
    const wheelX = originX + decoded.positions[index]!;
    // Sit the wheel rims just below the lowest point of the hull so the car
    // rides on its wheels instead of dragging it along the ground.
    const wheelY = originY + plateDrop + 3 - wheel.radius;
    const wheelBody = Bodies.circle(wheelX, wheelY, wheel.radius, {
      density: 0.0006,
      friction: wheel.friction,
      frictionAir: decoded.globals.dampingAngular,
      collisionFilter,
    });
    wheelBodies.push(wheelBody);

    // Only a wheel joined to a chassis can push anything: with no structure
    // the herd is loose parts (the design's "wheel wheel wheel has nothing
    // to go anywhere"). No chassis, no drive.
    const drive = wheelDriveForIndex(decoded, index);
    wheelDriveBodies.push({
      wheel: wheelBody,
      motorPower: chassis ? drive.power : 0,
      friction: wheel.friction,
    });

    if (chassis) {
      constraints.push(
        MatterConstraint.create({
          bodyA: chassis,
          // pointA is relative to the chassis's centre of mass.
          pointA: {
            x: wheelX - chassis.position.x,
            y: wheelY - chassis.position.y,
          },
          bodyB: wheelBody,
          pointB: { x: 0, y: 0 },
          length: 0,
          stiffness: 1,
          damping: 0.05,
        }),
      );
    }
  }

  return {
    chassisBodies: chassis ? [chassis] : [],
    wheelBodies,
    constraints,
    wheelDriveBodies,
  };
}

function snapshotBody(body: Body): BodySnapshot {
  const isCircle = typeof body.circleRadius === "number" && body.circleRadius > 0;
  const boundsWidth = body.bounds.max.x - body.bounds.min.x;
  const boundsHeight = body.bounds.max.y - body.bounds.min.y;

  return {
    x: body.position.x,
    y: body.position.y,
    angle: body.angle,
    shape: isCircle ? "circle" : "rectangle",
    radius: isCircle ? body.circleRadius ?? undefined : undefined,
    width: isCircle ? undefined : boundsWidth,
    height: isCircle ? undefined : boundsHeight,
  };
}

function snapshotVehicleBodies(
  chassisBodies: Body[],
  wheelBodies: Body[],
): VehicleSnapshot {
  const chassis = chassisBodies.map(snapshotBody);
  const wheels = wheelBodies.map(snapshotBody);
  const allBodies = [...chassis, ...wheels];
  const centerX =
    allBodies.reduce((sum, body) => sum + body.x, 0) / Math.max(allBodies.length, 1);
  const centerY =
    allBodies.reduce((sum, body) => sum + body.y, 0) / Math.max(allBodies.length, 1);

  return {
    chassis,
    wheels,
    centerX,
    centerY,
  };
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
  });
}

/** The legacy prototype drove each wheel with a SimpleMotor: spin toward a
 * target rate, but never with more than the torque the powertrain delivered.
 * Matter has no motors, so model one — a proportional torque chase, clamped
 * to the available torque. Teleporting angular velocity instead (the old
 * approach) yanked the rigid chassis into a spin. */
function applyWheelDrive(
  wheelDriveBodies: Array<{ wheel: Body; motorPower: number; friction: number }>,
): void {
  for (const drive of wheelDriveBodies) {
    if (drive.motorPower <= 0) {
      continue; // no cylinder upstream: this wheel is dead weight
    }
    const radius = drive.wheel.circleRadius ?? 18;
    // The legacy rate was negative in pymunk's y-UP world (clockwise = roll
    // right). Matter is y-DOWN, so rolling right is a POSITIVE spin — the
    // naive port drove every car backwards.
    const targetRate = (drive.motorPower / radius) * 0.14;
    const inertia = drive.wheel.inertia || 1;
    const error = targetRate - drive.wheel.angularVelocity;
    // Torque ceiling scales with the power the powertrain actually delivered
    // (a weak shaft can't spin a big wheel, a strong engine can).
    const availableTorque = 0.4 + drive.motorPower * 0.06;
    const torque = clampNumber(error * inertia * 0.8, -availableTorque, availableTorque);
    MatterBody.setAngularVelocity(
      drive.wheel,
      drive.wheel.angularVelocity + torque / inertia,
    );
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
