import Matter, { type Body, type Constraint, type Engine, type IChamferableBodyDefinition } from "matter-js";

import { decodeDnaV2, type DecodedDnaV2 } from "../shared/dna-v2.js";
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
    buildVehicleBodies(decoded, 220, 220);

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
      220 - index * 4,
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
  const chassis = vehicle.chassisBodies.map(snapshotBody);
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
  originY: number,
): {
  chassisBodies: Body[];
  wheelBodies: Body[];
  constraints: Constraint[];
  wheelDriveBodies: Array<{ wheel: Body; motorPower: number; friction: number }>;
} {
  const chassisBodies: Body[] = [];
  const wheelBodies: Body[] = [];
  const constraints: Constraint[] = [];
  const wheelDriveBodies: Array<{ wheel: Body; motorPower: number; friction: number }> = [];
  let lastChassisBody: Body | undefined;
  let lastChassisAnchorX = originX;

  for (const [index, module] of decoded.modules.entries()) {
    const anchorX = originX + decoded.positions[index]!;

    if (module === "R") {
      const rectangle = decoded.rectParams[index];

      if (!rectangle) {
        continue;
      }

      const body = Bodies.rectangle(
        anchorX,
        originY,
        rectangle.width,
        rectangle.height,
        {
          density: rectangle.density * 0.001,
          frictionAir: decoded.globals.dampingLinear,
          chamfer: { radius: 6 },
          collisionFilter: {
            category: VEHICLE_COLLISION_CATEGORY,
            mask: GROUND_COLLISION_CATEGORY,
          },
        } satisfies IChamferableBodyDefinition,
      );

      chassisBodies.push(body);

      if (lastChassisBody) {
        const connector = decoded.connectors.find(
          (candidate) => candidate.j === index,
        );
        constraints.push(
          MatterConstraint.create({
            bodyA: lastChassisBody,
            bodyB: body,
            stiffness: connector?.stiffnessK ?? 0.8,
            damping: connector?.dampingC ?? 0.2,
            length: Math.max(30, anchorX - lastChassisAnchorX),
          }),
        );
      }

      lastChassisBody = body;
      lastChassisAnchorX = anchorX;
      continue;
    }

    const wheel = decoded.wheelParams[index];

    if (!wheel) {
      continue;
    }

    const wheelBody = Bodies.circle(anchorX, originY + 50, wheel.radius, {
      friction: wheel.friction,
      frictionAir: decoded.globals.dampingAngular,
      collisionFilter: {
        category: VEHICLE_COLLISION_CATEGORY,
        mask: GROUND_COLLISION_CATEGORY,
      },
    });
    wheelBodies.push(wheelBody);
    wheelDriveBodies.push({
      wheel: wheelBody,
      motorPower: wheel.motorPower,
      friction: wheel.friction,
    });

    if (lastChassisBody) {
      constraints.push(
        MatterConstraint.create({
          bodyA: lastChassisBody,
          bodyB: wheelBody,
          stiffness: 0.9,
          damping: 0.15,
          length: 48,
        }),
      );
    }
  }

  return { chassisBodies, wheelBodies, constraints, wheelDriveBodies };
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

function applyWheelDrive(
  wheelDriveBodies: Array<{ wheel: Body; motorPower: number; friction: number }>,
): void {
  for (const drive of wheelDriveBodies) {
    MatterBody.applyForce(drive.wheel, drive.wheel.position, {
      x: drive.motorPower * drive.friction * 0.000012,
      y: 0,
    });
    MatterBody.setAngularVelocity(
      drive.wheel,
      Math.min(0.7, drive.wheel.angularVelocity + drive.motorPower * 0.000015),
    );
  }
}
