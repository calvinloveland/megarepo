import type { Page, TestInfo } from "@playwright/test";

type FailureLogger = {
  log: (...args: unknown[]) => void;
  flush: (failed: boolean) => void;
  entries: string[];
};

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack || value.message;
  try {
    return JSON.stringify(value);
  } catch (err) {
    return String(value);
  }
}

export function createFailureLogger(
  testInfo: TestInfo,
  page?: Page,
): FailureLogger {
  const entries: string[] = [];

  if (page) {
    page.on("console", (msg) => entries.push(`PAGE LOG: ${msg.text()}`));
    page.on("pageerror", (err) => entries.push(`PAGE ERROR: ${err.message}`));
    page.on("requestfailed", (req) =>
      entries.push(
        `REQUEST FAILED: ${req.url()} - ${req.failure()?.errorText}`,
      ),
    );
  }

  const log = (...args: unknown[]) => {
    entries.push(args.map(formatValue).join(" "));
  };

  const flush = (failed: boolean) => {
    const shouldLog = failed || testInfo.status !== testInfo.expectedStatus;
    if (shouldLog && entries.length) {
      console.log(entries.join("\n"));
    }
  };

  return { log, flush, entries };
}
