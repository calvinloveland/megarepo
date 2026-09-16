// What a vroomon's frame is made of, and what it costs.
//
// The design's rules live here so the physics and the inspector agree: a
// tilted plate drops its corner (so the hull rides lower or higher), a frame
// of plates out of line drags, and the power only counts for the wheels it
// actually reaches. Pure, so it can be tested and reused.

import { wheelDriveForIndex, type DecodedDnaV2 } from "./dna-v2.js";

export interface FramePlant {
  /** How far the lowest plate corner hangs below the chain line. */
  plateDrop: number;
  /** The largest rim in the chain. */
  biggestWheel: number;
  tiltCost: number;
  hullCost: number;
  /** Driven wheels over total wheels, 0..1. */
  traction: number;
  /**
   * Everything together: what the frame lets the powertrain do. 1 for a tidy
   * arch riding on driven wheels, toward 0 for a folded run of plates.
   */
  driveScale: number;
}

export interface DrivenWheel {
  index: number;
  power: number;
  torque: number;
}

/** How much the frame's geometry costs, before the tuning weights. */
export function frameGeometry(decoded: DecodedDnaV2): {
  plateDrop: number;
  biggestWheel: number;
  tiltDegrees: number;
  drivenWheels: number;
  wheels: number;
  plates: number;
} {
  const plates = decoded.modules.filter((module) => module === "R").length;
  const wheels = decoded.modules.filter((module) => module === "W").length;
  const tilts = decoded.rectParams
    .filter((rectangle): rectangle is NonNullable<typeof rectangle> => Boolean(rectangle))
    .map((rectangle) => {
      const tilt = (Math.abs(rectangle.angleDeg) * Math.PI) / 180;
      return {
        drop: (rectangle.height / 2) * Math.cos(tilt) + (rectangle.width / 2) * Math.sin(tilt),
        degrees: Math.abs(rectangle.angleDeg),
      };
    });
  const radii = decoded.wheelParams
    .filter((wheel): wheel is NonNullable<typeof wheel> => Boolean(wheel))
    .map((wheel) => wheel.radius);

  let drivenWheels = 0;
  decoded.modules.forEach((module, index) => {
    if (module === "W" && wheelDriveForIndex(decoded, index).power > 1) {
      drivenWheels += 1;
    }
  });

  return {
    plateDrop: tilts.length > 0 ? Math.max(...tilts.map((tilt) => tilt.drop)) : 12,
    biggestWheel: radii.length > 0 ? Math.max(...radii) : 0,
    tiltDegrees: tilts.reduce((sum, tilt) => sum + tilt.degrees, 0),
    drivenWheels,
    wheels,
    plates,
  };
}

/**
 * Apply the tuning weights to the geometry. Tuning lives in one object in the
 * simulation module, so it is passed in rather than imported.
 */
export function framePlant(
  decoded: DecodedDnaV2,
  weights: { tiltCost: number; hullCost: number },
): FramePlant {
  const geometry = frameGeometry(decoded);
  const tiltCost = geometry.tiltDegrees / 90;
  const hullCost = Math.min(
    1.5,
    Math.max(0, (geometry.plateDrop - geometry.biggestWheel) / 40),
  );
  const traction =
    geometry.wheels > 0 ? geometry.drivenWheels / geometry.wheels : 0;
  // With no plates there is no structure for the power to push against, and
  // with no wheels there is nothing to drive at all.
  const hasStructure = geometry.plates > 0;
  const driveScale = hasStructure
    ? traction / (1 + tiltCost * weights.tiltCost + hullCost * weights.hullCost)
    : 0;

  return {
    plateDrop: geometry.plateDrop,
    biggestWheel: geometry.biggestWheel,
    tiltCost,
    hullCost,
    traction,
    driveScale,
  };
}

/** Every wheel the power path reaches, best first. */
export function drivenWheels(decoded: DecodedDnaV2): DrivenWheel[] {
  const wheels: DrivenWheel[] = [];
  decoded.modules.forEach((module, index) => {
    if (module !== "W") {
      return;
    }
    const drive = wheelDriveForIndex(decoded, index);
    if (drive.power > 1) {
      wheels.push({
        index,
        power: Math.round(drive.power),
        torque: Math.round(drive.torque),
      });
    }
  });
  return wheels.sort((left, right) => right.power - left.power);
}
