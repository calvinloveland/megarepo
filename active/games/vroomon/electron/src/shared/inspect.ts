// Everything the inspector window shows about ONE vroomon: its parts laid out
// as geometry, its stats, and how a run on a track should be described.
// Pure and testable, so the window is only wiring.

import { decodeDnaV2, wheelDriveForIndex, type DecodedDnaV2 } from "./dna-v2.js";
import { drivenWheels, frameGeometry, framePlant, type FramePlant } from "./frame.js";

export const PLATE_DENSITY_SCALE = 0.001;
export const WHEEL_DENSITY_SCALE = 0.0006;

export interface RectShape {
  kind: "plate";
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  angleDeg: number;
}

export interface CircleShape {
  kind: "wheel";
  index: number;
  x: number;
  y: number;
  radius: number;
}

export type PartShape = RectShape | CircleShape;

export interface PartRow {
  index: number;
  kind: "plate" | "wheel";
  /** What the structure path puts here, in words. */
  structure: string;
  /** What the power path puts here (or "-" when it has nothing). */
  power: string;
  /** Power delivered to THIS wheel, or null for a plate. */
  drivePower: number | null;
  /** Right to left position along the frame. */
  offset: number;
}

export interface VehicleInspection {
  dna: string;
  modules: string;
  powertrain: string;
  rows: PartRow[];
  shapes: PartShape[];
  plant: FramePlant;
  plates: number;
  wheels: number;
  engines: number;
  shafts: number;
  gears: number;
  drivenCount: number;
  totalPower: number;
  totalTorque: number;
  /** Sum of every part's mass, using the same densities the sim builds with. */
  mass: number;
  /** Chain length, nose to tail. */
  length: number;
}

const POWER_NAMES: Record<string, string> = {
  C: "cylinder",
  D: "driveshaft",
  G: "gearset",
};

/** The parts of one vroomon, positioned the way the simulation builds them. */
export function inspectVehicle(
  dna: string,
  weights: { tiltCost: number; hullCost: number },
): VehicleInspection {
  const decoded: DecodedDnaV2 = decodeDnaV2(dna);
  // Plates sit on the chain line; wheels hang so their rims take the weight.
  const geometry = frameGeometry(decoded);
  const shapes: PartShape[] = [];
  const rows: PartRow[] = [];

  decoded.modules.forEach((module, index) => {
    const offset = decoded.positions[index] ?? 0;
    const powerModule = decoded.powertrainModules[index] ?? "";
    const power = POWER_NAMES[powerModule] ?? "—";

    if (module === "R") {
      const rectangle = decoded.rectParams[index];
      if (!rectangle) {
        return;
      }
      shapes.push({
        kind: "plate",
        index,
        x: offset,
        y: 0,
        width: rectangle.width,
        height: rectangle.height,
        angleDeg: rectangle.angleDeg,
      });
      rows.push({
        index,
        kind: "plate",
        structure: `plate ${Math.round(rectangle.width)}×${Math.round(rectangle.height)} @ ${rectangle.angleDeg >= 0 ? "+" : ""}${Math.round(rectangle.angleDeg)}°`,
        power,
        drivePower: null,
        offset,
      });
      return;
    }

    const wheel = decoded.wheelParams[index];
    if (!wheel) {
      return;
    }
    const drive = wheelDriveForIndex(decoded, index);
    shapes.push({ kind: "wheel", index, x: offset, y: wheel.radius, radius: wheel.radius });
    rows.push({
      index,
      kind: "wheel",
      structure: `wheel r${Math.round(wheel.radius)}`,
      power,
      drivePower: Math.round(drive.power),
      offset,
    });
  });

  const plateArea = decoded.rectParams.reduce(
    (sum, rectangle) => sum + (rectangle ? rectangle.width * rectangle.height : 0),
    0,
  );
  const wheelArea = decoded.wheelParams.reduce(
    (sum, wheel) => sum + (wheel ? Math.PI * wheel.radius * wheel.radius : 0),
    0,
  );
  const driven = drivenWheels(decoded);
  const firstOffset = decoded.positions[0] ?? 0;
  const lastOffset = decoded.positions[decoded.positions.length - 1] ?? firstOffset;
  const tail = decoded.wheelParams[decoded.modules.length - 1];
  const length = lastOffset - firstOffset + (tail ? tail.radius : 0);

  return {
    dna: decoded.dna,
    modules: decoded.modules.join(""),
    powertrain: decoded.powertrainModules.join(""),
    rows,
    shapes,
    plant: framePlant(decoded, weights),
    plates: geometry.plates,
    wheels: geometry.wheels,
    engines: decoded.powertrainModules.filter((kind) => kind === "C").length,
    shafts: decoded.powertrainModules.filter((kind) => kind === "D").length,
    gears: decoded.powertrainModules.filter((kind) => kind === "G").length,
    drivenCount: driven.length,
    totalPower: driven.reduce((sum, wheel) => sum + wheel.power, 0),
    totalTorque: driven.reduce((sum, wheel) => sum + wheel.torque, 0),
    // Matter's mass is area x density, the same sums the simulation builds.
    mass: plateArea * PLATE_DENSITY_SCALE * 1.1 + wheelArea * WHEEL_DENSITY_SCALE,
    length,
  };
}

/** The top speed this powertrain can hold, in px/s — the same maths the drive
 * applies, so the number matches what a run actually does. */
export function topSpeedFor(
  inspection: VehicleInspection,
  tuning: { terminalSpeedPerPower: number; referenceMass: number; maxSpeed: number },
): number {
  if (inspection.drivenCount === 0 || inspection.plant.driveScale <= 0) {
    return 0;
  }
  const heft = Math.max(0.6, Math.sqrt(inspection.mass / tuning.referenceMass));
  return Math.min(
    tuning.maxSpeed * 0.7,
    (inspection.totalPower * tuning.terminalSpeedPerPower) / heft,
  );
}

export interface TrackResult {
  terrain: string;
  distance: number;
  /** Fastest speed observed, px/s. */
  topSpeed: number;
  /** How far off the ground it got, px. */
  air: number;
  outcome: string;
}

/**
 * Say what a run did in plain language. The thresholds are in pixels over a
 * three-second race, matched to how cars actually perform: competitive means
 * it would put up a fight, not merely that it moved.
 */
export function trackResult(
  terrain: string,
  distance: number,
  topSpeed: number,
  air: number,
): TrackResult {
  const outcome = (() => {
    if (distance > 600) {
      return "flies";
    }
    if (distance > 300) {
      return "competitive";
    }
    if (distance > 60) {
      return "crawls";
    }
    if (distance < -60) {
      return "runs backwards";
    }
    return "sits there";
  })();
  return { terrain, distance, topSpeed, air, outcome };
}

/** Roll a vroomon's parts into one sentence for the inspector header. */
export function inspectionSummary(inspection: VehicleInspection): string {
  const { plant } = inspection;
  if (inspection.plates === 0) {
    return "No plates — nothing holds the wheels together.";
  }
  if (inspection.wheels === 0) {
    return "No wheels — this body cannot roll.";
  }
  if (inspection.engines === 0) {
    return "No cylinder in the chain — nothing can drive it.";
  }
  if (inspection.drivenCount === 0) {
    return "The power path reaches no wheel.";
  }
  const grip = Math.round(plant.driveScale * 100);
  return `Drive reaches ${inspection.drivenCount}/${inspection.wheels} wheels · frame puts ${grip}% of it on the ground.`;
}
