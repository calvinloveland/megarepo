import {
  Bodies,
  Body,
  Composite,
  Constraint,
  Engine,
  type IChamferableBodyDefinition,
} from "matter-js";

import { decodeDnaV2, type DecodedDnaV2 } from "../shared/dna-v2.js";
import {
  getTerrainPreset,
  type TerrainPresetDefinition,
} from "../shared/parity-contract.js";

export interface BodySnapshot {
  x: number;
  y: number;
  angle: number;
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
}

export function createMatterVehicle(
  dna: string,
  terrainName = "Grassland",
): MatterVehicle {
  const terrain = getTerrainPreset(terrainName);

  if (!terrain) {
    throw new Error(`Unknown terrain preset: ${terrainName}`);
  }

  const engine = Engine.create({
    gravity: { x: 0, y: 1, scale: 0.0012 },
  });
  const decoded = decodeDnaV2(dna);
  const terrainBodies = buildTerrainBodies(terrain);
  const { chassisBodies, wheelBodies, constraints } = buildVehicleBodies(decoded);

  Composite.add(engine.world, [...terrainBodies, ...chassisBodies, ...wheelBodies, ...constraints]);

  return {
    engine,
    terrain,
    decoded,
    terrainBodies,
    chassisBodies,
    wheelBodies,
    constraints,
  };
}

export function stepMatterVehicle(
  vehicle: MatterVehicle,
  stepCount = 180,
  deltaMs = 1000 / 60,
): VehicleSnapshot {
  for (let index = 0; index < stepCount; index += 1) {
    Engine.update(vehicle.engine, deltaMs);
  }

  return snapshotMatterVehicle(vehicle);
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
          { isStatic: true, friction: terrain.friction },
        ),
      );
    }
  }

  return bodies;
}

function buildVehicleBodies(decoded: DecodedDnaV2): {
  chassisBodies: Body[];
  wheelBodies: Body[];
  constraints: Constraint[];
} {
  const chassisBodies: Body[] = [];
  const wheelBodies: Body[] = [];
  const constraints: Constraint[] = [];
  let lastChassisBody: Body | undefined;
  let lastChassisAnchorX = 220;

  for (const [index, module] of decoded.modules.entries()) {
    const anchorX = 220 + decoded.positions[index]!;

    if (module === "R") {
      const rectangle = decoded.rectParams[index];

      if (!rectangle) {
        continue;
      }

      const body = Bodies.rectangle(anchorX, 220, rectangle.width, rectangle.height, {
        density: rectangle.density * 0.001,
        frictionAir: decoded.globals.dampingLinear,
        chamfer: { radius: 6 },
      } satisfies IChamferableBodyDefinition);

      chassisBodies.push(body);

      if (lastChassisBody) {
        const connector = decoded.connectors.find(
          (candidate) => candidate.j === index,
        );
        constraints.push(
          Constraint.create({
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

    const wheelBody = Bodies.circle(anchorX, 270, wheel.radius, {
      friction: wheel.friction,
      frictionAir: decoded.globals.dampingAngular,
    });
    wheelBodies.push(wheelBody);

    if (lastChassisBody) {
      constraints.push(
        Constraint.create({
          bodyA: lastChassisBody,
          bodyB: wheelBody,
          stiffness: 0.9,
          damping: 0.15,
          length: 48,
        }),
      );
    }
  }

  return { chassisBodies, wheelBodies, constraints };
}

function snapshotBody(body: Body): BodySnapshot {
  return {
    x: body.position.x,
    y: body.position.y,
    angle: body.angle,
  };
}
