import { describe, expect, it } from "vitest";

import { cleanDna, decodeDnaV2, uniformAt } from "../src/shared/dna-v2.js";
import dnaFixtures from "./fixtures/dna-v2-fixtures.json";

function roundDecodedDna(dna: string) {
  const decoded = decodeDnaV2(dna);

  return {
    dna: decoded.dna,
    modules: decoded.modules,
    powertrainModules: decoded.powertrainModules,
    positions: decoded.positions.map((value) => Number(value.toFixed(4))),
    rectParams: decoded.rectParams.map((value) =>
      value
        ? {
            width: Number(value.width.toFixed(4)),
            height: Number(value.height.toFixed(4)),
            density: Number(value.density.toFixed(4)),
          }
        : null,
    ),
    wheelParams: decoded.wheelParams.map((value) =>
      value
        ? {
            radius: Number(value.radius.toFixed(4)),
            friction: Number(value.friction.toFixed(4)),
            motorPower: Number(value.motorPower.toFixed(4)),
          }
        : null,
    ),
    powertrainParams: decoded.powertrainParams.map((value) => ({
      gearRatio: Number(value.gearRatio.toFixed(4)),
      efficiency: Number(value.efficiency.toFixed(4)),
    })),
    connectors: decoded.connectors.map((value) => ({
      i: value.i,
      j: value.j,
      angleDeg: Number(value.angleDeg.toFixed(4)),
      stiffnessK: Number(value.stiffnessK.toFixed(4)),
      dampingC: Number(value.dampingC.toFixed(4)),
      slackDeg: Number(value.slackDeg.toFixed(4)),
    })),
    globals: {
      comShift: Number(decoded.globals.comShift.toFixed(4)),
      dampingLinear: Number(decoded.globals.dampingLinear.toFixed(4)),
      dampingAngular: Number(decoded.globals.dampingAngular.toFixed(4)),
      temperature: Number(decoded.globals.temperature.toFixed(4)),
    },
  };
}

describe("DNA v2 utilities", () => {
  it("cleans non-base62 characters and keeps a deterministic fallback", () => {
    expect(cleanDna("A-9 z_!")).toBe("A9z");
    expect(cleanDna("!!!")).toBe("0");
  });

  it("decodes the same DNA string deterministically", () => {
    const first = decodeDnaV2("A3x9K2m7P4zQ");
    const second = decodeDnaV2("A3x9K2m7P4zQ");

    expect(second).toEqual(first);
  });

  it("keeps locality-preserving windows stable far away from a mutation", () => {
    const base = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const mutated = `${base.slice(0, 16)}z${base.slice(17)}`;

    expect(uniformAt(base, 2, 0)).toBe(uniformAt(mutated, 2, 0));
    expect(uniformAt(base, 2, 5)).toBe(uniformAt(mutated, 2, 5));
    expect(uniformAt(base, 2, 16)).not.toBe(uniformAt(mutated, 2, 16));
    expect(uniformAt(base, 2, 18)).not.toBe(uniformAt(mutated, 2, 18));
  });

  it("keeps decoded parameters inside the safety bounds from the Godot design", () => {
    const decoded = decodeDnaV2("A3x9K2m7P4zQ");

    for (const rectangle of decoded.rectParams.filter(Boolean)) {
      expect(rectangle.width).toBeGreaterThanOrEqual(24);
      expect(rectangle.width).toBeLessThanOrEqual(120);
      expect(rectangle.height).toBeGreaterThanOrEqual(12);
      expect(rectangle.height).toBeLessThanOrEqual(60);
      expect(rectangle.density).toBeGreaterThanOrEqual(0.5);
      expect(rectangle.density).toBeLessThanOrEqual(2);
    }

    for (const wheel of decoded.wheelParams.filter(Boolean)) {
      expect(wheel.radius).toBeGreaterThanOrEqual(10);
      expect(wheel.radius).toBeLessThanOrEqual(40);
      expect(wheel.friction).toBeGreaterThanOrEqual(0.4);
      expect(wheel.friction).toBeLessThanOrEqual(2);
      expect(wheel.motorPower).toBeGreaterThanOrEqual(0);
      expect(wheel.motorPower).toBeLessThanOrEqual(200);
    }

    expect(decoded.globals.dampingLinear).toBeGreaterThanOrEqual(0.01);
    expect(decoded.globals.dampingLinear).toBeLessThanOrEqual(0.5);
    expect(decoded.globals.dampingAngular).toBeGreaterThanOrEqual(0.01);
    expect(decoded.globals.dampingAngular).toBeLessThanOrEqual(0.7);
    expect(decoded.globals.temperature).toBeGreaterThanOrEqual(0.2);
    expect(decoded.globals.temperature).toBeLessThanOrEqual(1.5);
  });

  it("matches the stored regression fixtures for representative DNA samples", () => {
    expect(
      dnaFixtures.map((fixture) => roundDecodedDna(fixture.dna)),
    ).toEqual(dnaFixtures);
  });
});
