const BASE62_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const UINT32_SCALE = 2 ** 32;
const DEFAULT_LOCALITY_WINDOW = 4;

export type FrameModuleKind = "R" | "W";
export type PowertrainModuleKind = "C" | "D" | "G";

export interface RectangleParams {
  width: number;
  height: number;
  density: number;
  /** Tilt of this plate inside the chassis: a row of tilted plates forms
   * an arch (better breakover) or a folded mess that can't roll. */
  angleDeg: number;
}

export interface WheelParams {
  radius: number;
  friction: number;
  motorPower: number;
}

export interface PowertrainParams {
  /** Gear-set input ratio (also kept as a display value). */
  gearRatio: number;
  /** Drive-shaft efficiency. */
  efficiency: number;
  /** Cylinder output, in the legacy power units the wheels are driven in. */
  power: number;
  /** Gear-set share handed to the wheel at its own index. */
  wheelProportion: number;
  /** Gear-set ratio applied to what carries on down the shaft. */
  outputRatio: number;
}

export interface ConnectorParams {
  i: number;
  j: number;
  angleDeg: number;
  stiffnessK: number;
  dampingC: number;
  slackDeg: number;
}

export interface GlobalParams {
  comShift: number;
  dampingLinear: number;
  dampingAngular: number;
  temperature: number;
}

export interface DecodedDnaV2 {
  dna: string;
  modules: FrameModuleKind[];
  powertrainModules: PowertrainModuleKind[];
  positions: number[];
  rectParams: Array<RectangleParams | null>;
  wheelParams: Array<WheelParams | null>;
  powertrainParams: PowertrainParams[];
  connectors: ConnectorParams[];
  globals: GlobalParams;
}

export function cleanDna(dna: string): string {
  const cleaned = [...dna].filter(isBase62).join("");
  return cleaned.length > 0 ? cleaned : "0";
}

export function createRandomDna(length = 12, random = Math.random): string {
  const clampedLength = Math.max(1, Math.floor(length));
  let result = "";

  for (let index = 0; index < clampedLength; index += 1) {
    const alphabetIndex = Math.floor(random() * BASE62_ALPHABET.length);
    result += BASE62_ALPHABET[alphabetIndex] ?? BASE62_ALPHABET[0];
  }

  return result;
}

export function isBase62(character: string): boolean {
  return character.length === 1 && BASE62_ALPHABET.includes(character);
}

export function base62Value(character: string): number {
  const index = BASE62_ALPHABET.indexOf(character);
  return index >= 0 ? index : 0;
}

export function uniformAt(
  dna: string,
  channel: number,
  index: number,
  window = DEFAULT_LOCALITY_WINDOW,
): number {
  const cleanedDna = cleanDna(dna);
  const dnaLength = cleanedDna.length;

  if (dnaLength === 0) {
    return 0.5;
  }

  let hash = 0;

  for (let offset = -window; offset <= window; offset += 1) {
    const position = modulo(index + offset, dnaLength);
    hash =
      (hash ^
        mix32(channel, index, position, base62Value(cleanedDna[position]!))) >>>
      0;
  }

  return hash / UINT32_SCALE;
}

export function inverseNormalCdf(probability: number): number {
  const p = clamp(probability, 1e-9, 1 - 1e-9);
  const a = [
    -3.969683028665376e1,
    2.209460984245205e2,
    -2.759285104469687e2,
    1.38357751867269e2,
    -3.066479806614716e1,
    2.506628277459239,
  ] as const;
  const b = [
    -5.447609879822406e1,
    1.615858368580409e2,
    -1.556989798598866e2,
    6.680131188771972e1,
    -1.328068155288572e1,
  ] as const;
  const c = [
    -7.784894002430293e-3,
    -3.223964580411365e-1,
    -2.400758277161838,
    -2.549732539343734,
    4.374664141464968,
    2.938163982698783,
  ] as const;
  const d = [
    7.784695709041462e-3,
    3.224671290700398e-1,
    2.445134137142996,
    3.754408661907416,
  ] as const;

  const plow = 0.02425;
  const phigh = 1 - plow;

  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }

  if (p > phigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }

  const q = p - 0.5;
  const r = q * q;

  return (
    (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
    q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

export function decodeDnaV2(dna: string): DecodedDnaV2 {
  const cleanedDna = cleanDna(dna);
  const moduleCount = computeModuleCount(cleanedDna);
  const modules = Array.from({ length: moduleCount }, (_, index) =>
    uniformAt(cleanedDna, 1, index) < 0.6 ? "R" : "W",
  );
  const powertrainModules = Array.from({ length: moduleCount }, (_, index) =>
    pickPowertrainModule(uniformAt(cleanedDna, 17, index)),
  );

  const rectParams = modules.map((module, index) =>
    module === "R"
      ? {
          width: clamp(44 + 9 * zNormal(cleanedDna, 2, index), 26, 104),
          height: clamp(20 + 5 * zNormal(cleanedDna, 3, index), 12, 52),
          density: clamp(0.9 + 0.2 * zNormal(cleanedDna, 4, index), 0.5, 1.6),
          angleDeg: clamp(16 * zNormal(cleanedDna, 19, index), -24, 24),
        }
      : null,
  );

  const wheelParams = modules.map((module, index) =>
    module === "W"
      ? {
          radius: clamp(20 + 6 * zNormal(cleanedDna, 5, index), 12, 42),
          friction: clamp(1.6 + 0.3 * zNormal(cleanedDna, 6, index), 0.8, 2.4),
          motorPower: clamp(90 + 40 * zNormal(cleanedDna, 7, index), 0, 200),
        }
      : null,
  );

  // The frame is a CHAIN of edge-joined parts: each plate occupies its own
  // span (so neighbours meet at the edges, not piled on top of each other)
  // and each wheel gets a slot sized to its rim. wheel-rectangle-wheel reads
  // as a simple car, wheel-wheel-wheel is three wheels with nothing between
  // them, and a run of plates can arch.
  const positions: number[] = [];
  let xAccumulator = 0;
  for (const [index, module] of modules.entries()) {
    if (module === "R") {
      const width = rectParams[index]?.width ?? 44;
      xAccumulator += width * 0.78 + 4;
    } else {
      const radius = wheelParams[index]?.radius ?? 20;
      xAccumulator += radius * 1.9;
    }
    positions.push(xAccumulator);
  }

  const powertrainParams = powertrainModules.map((_, index) => ({
    gearRatio: clamp(1 + 0.35 * zNormal(cleanedDna, 8, index), 0.4, 2.4),
    efficiency: clamp(0.92 + 0.05 * zNormal(cleanedDna, 9, index), 0.5, 1),
    power: clamp(110 + 35 * zNormal(cleanedDna, 21, index), 15, 220),
    wheelProportion: clamp(0.5 + 0.2 * zNormal(cleanedDna, 22, index), 0.1, 0.9),
    outputRatio: clamp(1 + 0.3 * zNormal(cleanedDna, 23, index), 0.4, 2.2),
  }));

  const connectors: ConnectorParams[] = [];

  for (let index = 0; index < modules.length - 1; index += 1) {
    if (modules[index] === "R" && modules[index + 1] === "R") {
      connectors.push({
        i: index,
        j: index + 1,
        angleDeg: clamp(20 * zNormal(cleanedDna, 13, index), -90, 90),
        stiffnessK: clamp(0.8 + 0.3 * zNormal(cleanedDna, 14, index), 0.1, 2),
        dampingC: clamp(0.4 + 0.2 * zNormal(cleanedDna, 15, index), 0.05, 1),
        slackDeg: clamp(2 + zNormal(cleanedDna, 16, index), 0, 10),
      });
    }
  }

  return {
    dna: cleanedDna,
    modules,
    powertrainModules,
    positions,
    rectParams,
    wheelParams,
    powertrainParams,
    connectors,
    globals: {
      comShift: 5 * zNormal(cleanedDna, 10, 0),
      dampingLinear: clamp(0.1 + 0.05 * zNormal(cleanedDna, 11, 0), 0.01, 0.5),
      dampingAngular: clamp(
        0.2 + 0.05 * zNormal(cleanedDna, 12, 0),
        0.01,
        0.7,
      ),
      temperature: clamp(0.2 + 1.3 * uniformAt(cleanedDna, 18, 0), 0.2, 1.5),
    },
  };
}

function computeModuleCount(dna: string): number {
  let accumulator = 2;
  let moduleCount = 0;

  for (let index = 0; accumulator < 6 && index < 64; index += 1) {
    accumulator += 0.6 + 0.8 * uniformAt(dna, 0, index);
    moduleCount = Math.floor(accumulator);
  }

  return Math.max(2, moduleCount);
}

function pickPowertrainModule(value: number): PowertrainModuleKind {
  if (value < 1 / 3) {
    return "C";
  }

  if (value < 2 / 3) {
    return "D";
  }

  return "G";
}

function zNormal(dna: string, channel: number, index: number): number {
  return inverseNormalCdf(uniformAt(dna, channel, index));
}

function mix32(
  channel: number,
  index: number,
  position: number,
  value: number,
): number {
  let hash =
    (Math.imul(channel | 0, 0x9e3779b1) ^
      Math.imul(index | 0, 0x85ebca6b) ^
      Math.imul(position | 0, 0xc2b2ae35) ^
      (value | 0)) >>>
    0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}


// ---- The power path ----
// A car's powertrain is a SERIES: cylinders make power, drive shafts lose a
// little of it, and gear sets hand a share to the wheel at their own index
// before passing the rest on. Walking it for each wheel index is exactly the
// legacy prototype's `calculate_wheel_power`: order matters, most orderings
// don't drive anything, and a wheel with no cylinder upstream just sits
// there. This is where "most combinations won't make a working car" comes
// from.

const TORQUE_BASE = 10_000;

export interface WheelDrive {
  power: number;
  torque: number;
}

export function wheelDriveForIndex(
  decoded: DecodedDnaV2,
  wheelIndex: number,
): WheelDrive {
  let power = 0;
  let torque = TORQUE_BASE;
  const last = Math.min(wheelIndex, decoded.powertrainModules.length - 1);

  for (let index = 0; index <= last; index += 1) {
    const kind = decoded.powertrainModules[index];
    const params = decoded.powertrainParams[index];
    if (!params) {
      continue;
    }
    if (kind === "C") {
      power += params.power;
    } else if (kind === "D") {
      power *= params.efficiency;
      torque *= params.efficiency;
    } else {
      power *= params.gearRatio;
      torque /= params.gearRatio;
      if (index === wheelIndex) {
        return {
          power: power * params.wheelProportion,
          torque: torque * params.wheelProportion,
        };
      }
      power -= power * params.wheelProportion;
      torque -= torque * params.wheelProportion;
      power *= params.outputRatio;
      torque /= params.outputRatio;
    }
    if (index === wheelIndex) {
      return { power, torque };
    }
  }

  return { power, torque };
}
