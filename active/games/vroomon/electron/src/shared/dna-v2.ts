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
}

export interface WheelParams {
  radius: number;
  friction: number;
  motorPower: number;
}

export interface PowertrainParams {
  gearRatio: number;
  efficiency: number;
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

  const positions: number[] = [];
  let xAccumulator = 0;
  let lastRectangleAnchor = 0;

  for (const [index, module] of modules.entries()) {
    if (module === "R") {
      const deltaX = clamp(50 + 10 * zNormal(cleanedDna, 20, index), 25, 90);
      xAccumulator += deltaX;
      lastRectangleAnchor = xAccumulator;
      positions.push(xAccumulator);
    } else {
      positions.push(lastRectangleAnchor);
    }
  }

  const rectParams = modules.map((module, index) =>
    module === "R"
      ? {
          width: clamp(48 + 10 * zNormal(cleanedDna, 2, index), 24, 120),
          height: clamp(24 + 6 * zNormal(cleanedDna, 3, index), 12, 60),
          density: clamp(1 + 0.25 * zNormal(cleanedDna, 4, index), 0.5, 2),
        }
      : null,
  );

  const wheelParams = modules.map((module, index) =>
    module === "W"
      ? {
          radius: clamp(18 + 6 * zNormal(cleanedDna, 5, index), 10, 40),
          friction: clamp(1 + 0.3 * zNormal(cleanedDna, 6, index), 0.4, 2),
          motorPower: clamp(90 + 40 * zNormal(cleanedDna, 7, index), 0, 200),
        }
      : null,
  );

  const powertrainParams = powertrainModules.map((_, index) => ({
    gearRatio: clamp(2 + 0.6 * zNormal(cleanedDna, 8, index), 0.5, 5),
    efficiency: clamp(0.9 + 0.05 * zNormal(cleanedDna, 9, index), 0.5, 1),
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
