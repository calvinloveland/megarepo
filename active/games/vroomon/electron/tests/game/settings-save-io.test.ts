import { describe, expect, it } from "vitest";
import { normalizeSettings } from "../../src/renderer/settings.js";
import {
  decodeRun,
  decodeWorld,
  encodeRun,
  encodeWorld,
} from "../../src/renderer/save-io.js";
import { createEmptyRunState } from "../../src/shared/parity-contract.js";
import { EMPTY_PERSISTED_WORLD } from "../../src/renderer/world/types.js";

describe("settings normalization", () => {
  it("defaults when nothing is stored", () => {
    expect(normalizeSettings(null)).toEqual({
      masterVolume: 0.8,
      ambienceEnabled: true,
      ambienceVolume: 2,
    });
  });

  it("clamps the master volume and rejects bad ambience levels", () => {
    const settings = normalizeSettings({
      masterVolume: 7,
      ambienceEnabled: false,
      ambienceVolume: 3,
    });
    expect(settings.masterVolume).toBe(1);
    expect(settings.ambienceVolume).toBe(2);
  });

  it("accepts a quiet profile", () => {
    const settings = normalizeSettings({ masterVolume: 0.1, ambienceVolume: 1 });
    expect(settings.masterVolume).toBe(0.1);
    expect(settings.ambienceVolume).toBe(1);
  });
});

describe("save transfer strings", () => {
  it("round-trips a world state", () => {
    const world = {
      ...EMPTY_PERSISTED_WORLD,
      badges: ["Grassland Brand"],
      rancherName: "Io",
      flags: { "met-axle": true },
    };
    const decoded = decodeWorld(encodeWorld(world));
    expect(decoded?.rancherName).toBe("Io");
    expect(decoded?.badges).toEqual(["Grassland Brand"]);
  });

  it("round-trips a run state", () => {
    const run = createEmptyRunState("evolution");
    const decoded = decodeRun(encodeRun(run));
    expect(decoded?.mode).toBe("evolution");
    expect(decoded?.runId).toBe(run.runId);
  });

  it("rejects garbage", () => {
    expect(decodeWorld("not-base64!!!")).toBeNull();
    expect(decodeRun("aGVsbG8=")).toBeNull(); // valid base64, wrong shape
  });
});
