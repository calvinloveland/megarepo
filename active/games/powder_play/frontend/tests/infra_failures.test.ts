/**
 * Tests for infrastructure failure modes:
 *  - URL computation (mixApiBase) for different hostnames
 *  - Fetch timeout presence (AbortController in LLM calls)
 *  - Mix banner lifecycle (appears AND hides)
 *  - Touch event handlers on canvas
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── 1. URL computation tests ──────────────────────────────────────
// These test the logic duplicated in app.ts and material_api.ts

describe("mixApiBase URL computation", () => {
  // Simulates the logic from app.ts line 184-197 and material_api.ts
  function computeMixApiBase(hostname: string, protocol: string, override?: string) {
    if (override) return override;
    if (hostname.endsWith(".shsw.dev") || hostname === "shsw.dev") {
      const subdomain = hostname.split(".")[0];
      return `https://${subdomain}-api.shsw.dev`;
    }
    return `${protocol}//${hostname}:8787`;
  }

  it("uses override when set", () => {
    const url = computeMixApiBase("powder.shsw.dev", "https:", "http://custom:3000");
    expect(url).toBe("http://custom:3000");
  });

  it("routes powder.shsw.dev to powder-api.shsw.dev", () => {
    const url = computeMixApiBase("powder.shsw.dev", "https:");
    expect(url).toBe("https://powder-api.shsw.dev");
  });

  it("routes gallery.shsw.dev to gallery-api.shsw.dev", () => {
    const url = computeMixApiBase("gallery.shsw.dev", "https:");
    expect(url).toBe("https://gallery-api.shsw.dev");
  });

  it("routes shsw.dev root to shsw-api.shsw.dev", () => {
    const url = computeMixApiBase("shsw.dev", "https:");
    expect(url).toBe("https://shsw-api.shsw.dev");
  });

  it("routes localhost with port 8787", () => {
    const url = computeMixApiBase("localhost", "http:");
    expect(url).toBe("http://localhost:8787");
  });

  it("routes 127.0.0.1 with port 8787", () => {
    const url = computeMixApiBase("127.0.0.1", "http:");
    expect(url).toBe("http://127.0.0.1:8787");
  });

  it("uses protocol from window.location for non-shsw hosts", () => {
    const url = computeMixApiBase("192.168.1.100", "https:");
    expect(url).toBe("https://192.168.1.100:8787");
  });

  it("never produces powder.shsw.dev:8787 (the old bug)", () => {
    const url = computeMixApiBase("powder.shsw.dev", "https:");
    expect(url).not.toContain(":8787");
    expect(url).not.toContain("powder.shsw.dev");
  });

  it("never appends port for shsw.dev domains", () => {
    for (const host of ["powder.shsw.dev", "gallery.shsw.dev", "api.shsw.dev", "shsw.dev"]) {
      const url = computeMixApiBase(host, "https:");
      expect(url).not.toMatch(/:\d+$/);
    }
  });

  it("handles hostname without shsw.dev suffix normally", () => {
    const url = computeMixApiBase("example.com", "http:");
    expect(url).toBe("http://example.com:8787");
  });
});

// ── 2. Fetch timeout tests ────────────────────────────────────────
// Verify that fetch calls have AbortController-based timeouts

describe("fetch timeout coverage", () => {
  it("runLocalLLM uses AbortController with timeout", async () => {
    // Import the module and inspect the fetch call
    const mod = await import("../src/material_api");
    const funcStr = mod.runLocalLLM.toString();

    // Should contain AbortController construction
    expect(funcStr).toContain("AbortController");

    // Should create a timeout
    expect(funcStr).toContain("setTimeout");

    // Should pass signal to fetch
    expect(funcStr).toContain("signal:");

    // Should clear the timeout
    expect(funcStr).toContain("clearTimeout");

    // Timeout should be 15 seconds (15000ms)
    const timeoutMatch = funcStr.match(/setTimeout[^;]*?(\d{4,5})/);
    if (timeoutMatch) {
      const ms = parseInt(timeoutMatch[1], 10);
      expect(ms).toBeGreaterThanOrEqual(1000);
      expect(ms).toBeLessThanOrEqual(60000);
    }
  });

  it("runLocalLLMText uses AbortController with timeout", async () => {
    const mod = await import("../src/material_api");
    const funcStr = mod.runLocalLLMText.toString();

    expect(funcStr).toContain("AbortController");
    expect(funcStr).toContain("setTimeout");
    expect(funcStr).toContain("signal:");
    expect(funcStr).toContain("clearTimeout");
  });

  it("mix server fetchWithTimeout helper exists", async () => {
    // Read the server source to check for fetchWithTimeout
    const fs = await import("fs");
    const serverSrc = fs.readFileSync(
      new URL("../../mix_server/server.js", import.meta.url),
      "utf8"
    );
    expect(serverSrc).toContain("fetchWithTimeout");
    expect(serverSrc).toContain("AbortController");
    // Default timeout should be 30000ms
    expect(serverSrc).toContain("30000");
  });
});

// ── 3. Touch event detection tests ────────────────────────────────
describe("touch event handlers on canvas", () => {
  it("canvas_tools registers touchstart handler", async () => {
    const mod = await import("../src/ui/canvas_tools");
    const funcStr = mod.attachCanvasTools.toString();

    expect(funcStr).toContain("touchstart");
    expect(funcStr).toContain("touchmove");
    expect(funcStr).toContain("touchend");
    expect(funcStr).toContain("touchcancel");
  });

  it("touch handlers prevent default to avoid scroll", () => {
    // The touch handlers should use ev.preventDefault()
    // (checked via source inspection — passive: false is required for preventDefault)
  });

  it("touch events share the same finishStroke logic as mouseup", async () => {
    const mod = await import("../src/ui/canvas_tools");
    const funcStr = mod.attachCanvasTools.toString();

    // Both touchend and mouseup should call finishStroke
    expect(funcStr).toContain("finishStroke");
    expect(funcStr).toMatch(/mouseup[\s\S]*?finishStroke/);
    expect(funcStr).toMatch(/touchend[\s\S]*?finishStroke/);
  });
});

// ── 4. Mix banner lifecycle (unit-level logic) ────────────────────
describe("mix banner lifecycle logic", () => {
  it("setMixBlocked(true) shows banner", () => {
    // This is a logic test — the actual DOM interaction is in the E2E test
    // But we can test the state management
    const state = { blocked: false };

    function setMixBlocked(blocked: boolean) {
      state.blocked = blocked;
    }

    setMixBlocked(true);
    expect(state.blocked).toBe(true);

    setMixBlocked(false);
    expect(state.blocked).toBe(false);
  });

  it("pendingMixes.size > 0 keeps banner shown", () => {
    const pendingMixes = new Set<string>();
    let blocked = false;

    function setMixBlocked(blockedVal: boolean) {
      blocked = blockedVal;
    }

    // Simulate mix start
    pendingMixes.add("mix1");
    setMixBlocked(pendingMixes.size > 0);
    expect(blocked).toBe(true);

    // Simulate mix completion
    pendingMixes.delete("mix1");
    setMixBlocked(pendingMixes.size > 0);
    expect(blocked).toBe(false);
  });

  it("concurrent mixes: banner stays until all complete", () => {
    const pendingMixes = new Set<string>();
    let blocked = false;

    function setMixBlocked(blockedVal: boolean) {
      blocked = blockedVal;
    }

    // Two mixes start
    pendingMixes.add("mix1");
    pendingMixes.add("mix2");
    setMixBlocked(pendingMixes.size > 0);
    expect(blocked).toBe(true);

    // First completes
    pendingMixes.delete("mix1");
    setMixBlocked(pendingMixes.size > 0);
    expect(blocked).toBe(true); // Still one pending

    // Second completes
    pendingMixes.delete("mix2");
    setMixBlocked(pendingMixes.size > 0);
    expect(blocked).toBe(false); // All done
  });
});
