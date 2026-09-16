// A plain-language readout of what a DNA string actually builds: the two
// paths, and — the part you can't see by looking — which wheels the power
// chain actually reaches. Pure, so it can be tested and reused anywhere.

import { wheelDriveForIndex, type DecodedDnaV2 } from "./dna-v2.js";

export interface DrivenWheel {
  /** Index in the chain (frame and powertrain share indices). */
  index: number;
  power: number;
  torque: number;
}

export interface VehicleBlueprint {
  structure: string;
  power: string;
  plates: number;
  wheels: number;
  engines: number;
  shafts: number;
  gears: number;
  /** Wheels the power path actually turns, best first. */
  driven: DrivenWheel[];
  deadWheels: number;
  /** "This one drives." / "Nothing reaches a wheel…" etc. */
  verdict: string;
}

export function describeVehicle(decoded: DecodedDnaV2): VehicleBlueprint {
  const plates = decoded.modules.filter((module) => module === "R").length;
  const wheels = decoded.modules.filter((module) => module === "W").length;
  const engines = decoded.powertrainModules.filter((kind) => kind === "C").length;
  const shafts = decoded.powertrainModules.filter((kind) => kind === "D").length;
  const gears = decoded.powertrainModules.filter((kind) => kind === "G").length;

  const driven: DrivenWheel[] = [];
  decoded.modules.forEach((module, index) => {
    if (module !== "W") {
      return;
    }
    const drive = wheelDriveForIndex(decoded, index);
    if (drive.power > 1) {
      driven.push({ index, power: Math.round(drive.power), torque: Math.round(drive.torque) });
    }
  });
  driven.sort((left, right) => right.power - left.power);

  const verdict = (() => {
    if (plates === 0) {
      return "No plates — nothing holds the wheels together.";
    }
    if (wheels === 0) {
      return "No wheels — this body can't roll.";
    }
    if (engines === 0) {
      return "No engine in the chain — nothing can drive it.";
    }
    if (driven.length === 0) {
      return "The engine sits past every wheel — turn it around.";
    }
    if (driven.length < wheels) {
      return `${driven.length} of ${wheels} wheels get drive; the rest are along for the ride.`;
    }
    return "Drive reaches every wheel.";
  })();

  return {
    structure: `${plates} plate${plates === 1 ? "" : "s"} · ${wheels} wheel${wheels === 1 ? "" : "s"}`,
    power: `${engines} engine${engines === 1 ? "" : "s"} · ${shafts} shaft${shafts === 1 ? "" : "s"} · ${gears} gear${gears === 1 ? "" : "s"}`,
    plates,
    wheels,
    engines,
    shafts,
    gears,
    driven,
    deadWheels: wheels - driven.length,
    verdict,
  };
}
