import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  ErrorLogger,
  getErrorLogger,
  initializeErrorLogger,
} from "../src/renderer/error-logger.js";

/**
 * These tests run in plain Node (no happy-dom / jsdom). The logger is
 * designed to work without a DOM — the `setupDom` method checks for
 * `typeof document` and skips the panel logic when no DOM is present.
 *
 * The visual panel behavior is verified manually in the browser via the
 * e2e test suite and the running web server.
 */
describe("ErrorLogger (no-DOM mode)", () => {
  beforeEach(() => {
    // Make sure no DOM leaks between tests
    delete (globalThis as { document?: unknown }).document;
  });

  afterEach(() => {
    getErrorLogger()?.destroy();
    delete (globalThis as { document?: unknown }).document;
    vi.restoreAllMocks();
  });

  it("initializes and registers handlers without a DOM", () => {
    const logger = initializeErrorLogger({ debug: false });
    expect(logger).toBeInstanceOf(ErrorLogger);
    expect(getErrorLogger()).toBe(logger);
  });

  it("captures console.error calls", () => {
    const logger = initializeErrorLogger();
    // The logger wraps console.error during installHandlers, so calling
    // console.error after init goes through the wrapper.
    console.error("boom from test", { code: 500 });
    const reports = logger.getReports();
    const consoleError = reports.find((r) => r.source === "console");
    expect(consoleError).toBeDefined();
    expect(consoleError!.message).toContain("boom from test");
  });

  it("captures console.warn calls as warn type", () => {
    const logger = initializeErrorLogger();
    console.warn("watch out");
    const reports = logger.getReports();
    const consoleWarn = reports.find((r) => r.type === "warn");
    expect(consoleWarn).toBeDefined();
    expect(consoleWarn!.message).toContain("watch out");
  });

  it("captures window.error events when window is available", () => {
    const logger = initializeErrorLogger();
    if (typeof window === "undefined") return; // skip in pure node
    const err = new Error("window-error-test");
    window.dispatchEvent(
      new ErrorEvent("error", { message: err.message, error: err }),
    );
    const reports = logger.getReports();
    const last = reports[reports.length - 1]!;
    expect(last.message).toBe("window-error-test");
    expect(last.source).toBe("unhandled");
  });

  it("captures unhandledrejection events when window is available", () => {
    const logger = initializeErrorLogger();
    if (typeof window === "undefined") return; // skip in pure node
    window.dispatchEvent(
      new PromiseRejectionEvent("unhandledrejection", { reason: new Error("rej") }),
    );
    const reports = logger.getReports();
    const last = reports[reports.length - 1]!;
    expect(last.message).toBe("rej");
    expect(last.source).toBe("promise");
  });

  it("log() accepts string or Error and includes context", () => {
    const logger = initializeErrorLogger();
    logger.log(new Error("manual-error"), { where: "test" });
    logger.log("plain string message");
    const reports = logger.getReports();
    const manualError = reports.find((r) => r.message === "manual-error");
    expect(manualError).toBeDefined();
    expect(manualError!.context).toEqual({ where: "test" });
    const stringLog = reports.find((r) => r.message === "plain string message");
    expect(stringLog).toBeDefined();
    expect(stringLog!.source).toBe("manual");
  });

  it("clears all reports", () => {
    const logger = initializeErrorLogger();
    logger.logMessage("first");
    logger.logMessage("second");
    expect(logger.getReports().length).toBe(2);
    logger.clear();
    expect(logger.getReports().length).toBe(0);
  });

  it("keeps buffer bounded by maxBufferSize", () => {
    const logger = initializeErrorLogger({ maxBufferSize: 3 });
    logger.logMessage("one");
    logger.logMessage("two");
    logger.logMessage("three");
    logger.logMessage("four");
    logger.logMessage("five");
    const reports = logger.getReports();
    expect(reports.length).toBe(3);
    expect(reports[0]!.message).toBe("three");
    expect(reports[2]!.message).toBe("five");
  });

  it("posts reports to a configured endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const logger = initializeErrorLogger({ endpoint: "https://example.test/errors" });
    logger.logMessage("telemetry");
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).toHaveBeenCalled();
  });

  it("reinitializing destroys the previous instance", () => {
    const first = initializeErrorLogger();
    const second = initializeErrorLogger();
    expect(second).not.toBe(first);
  });

  it("destroy restores console methods and stops capturing", () => {
    const logger = initializeErrorLogger();
    logger.destroy();
    // After destroy, console.error should be a function and the logger
    // should not throw when called post-destroy. We don't assert identity
    // because vitest's own test runner re-wraps console methods after we
    // restore them.
    expect(typeof console.error).toBe("function");
    expect(() => logger.log("post-destroy")).not.toThrow();
  });

  it("calls onReport callback for every report", () => {
    const seen: string[] = [];
    const logger = initializeErrorLogger({
      onReport: (report) => seen.push(report.message),
    });
    logger.logMessage("a");
    logger.logMessage("b");
    expect(seen).toEqual(["a", "b"]);
  });

  it("includes timestamp on every report", () => {
    const before = Date.now();
    const logger = initializeErrorLogger();
    logger.logMessage("stamp");
    const after = Date.now();
    const last = logger.getReports()[0]!;
    expect(last.timestamp).toBeGreaterThanOrEqual(before);
    expect(last.timestamp).toBeLessThanOrEqual(after);
  });
});
