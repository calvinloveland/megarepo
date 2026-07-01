/**
 * Browser Error Logger for Vroomon.
 *
 * Captures JavaScript errors, unhandled promise rejections, and console
 * errors. Reports them to a visual panel in the page so the user can see
 * what broke, and optionally POSTs them to a configured endpoint.
 *
 * Modeled after the HiveMind errorLogger but self-contained and tuned for
 * the vroomon web deployment.
 */

export interface ErrorReport {
  id: string;
  message: string;
  stack?: string;
  type: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  timestamp: number;
  source: "unhandled" | "promise" | "console" | "manual";
  context?: Record<string, unknown>;
}

export interface ErrorLoggerConfig {
  endpoint?: string;
  debug?: boolean;
  onReport?: (report: ErrorReport) => void;
  maxBufferSize?: number;
}

const TYPE_COLORS: Record<string, string> = {
  Error: "#ff6b4a",
  TypeError: "#ff6b4a",
  ReferenceError: "#ff6b4a",
  SyntaxError: "#ffd166",
  UnhandledRejection: "#ff6b4a",
  GPUError: "#a23a2a",
  console: "#97abc7",
  warn: "#ffd166",
};

export class ErrorLogger {
  private buffer: ErrorReport[] = [];
  private config: ErrorLoggerConfig;
  private destroyed = false;
  private originalConsoleError: typeof console.error;
  private originalConsoleWarn: typeof console.warn;
  private originalConsoleLog: typeof console.log;
  private panel: HTMLElement | null = null;
  private toggle: HTMLElement | null = null;
  private list: HTMLElement | null = null;
  private badge: HTMLElement | null = null;

  constructor(config: ErrorLoggerConfig = {}) {
    this.config = {
      maxBufferSize: 100,
      ...config,
    };
    this.originalConsoleError = console.error.bind(console);
    this.originalConsoleWarn = console.warn.bind(console);
    this.originalConsoleLog = console.log.bind(console);

    this.setupDom();
    this.installHandlers();
  }

  private setupDom(): void {
    if (typeof document === "undefined") return;
    this.panel = document.querySelector("[data-error-panel]");
    this.toggle = document.querySelector("[data-error-toggle]");
    this.list = document.querySelector("[data-error-list]");
    this.badge = document.querySelector("[data-error-badge]");

    if (this.toggle) {
      this.toggle.addEventListener("click", () => {
        if (!this.panel) return;
        this.panel.classList.toggle("error-panel--open");
      });
    }

    this.renderPanel();
  }

  private installHandlers(): void {
    if (typeof window !== "undefined") {
      window.addEventListener("error", (event) => {
        this.captureFromEvent(event.error, "unhandled", {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        });
      });

      window.addEventListener("unhandledrejection", (event) => {
        const reason = event.reason;
        this.captureFromEvent(reason, "promise");
      });
    }

    console.error = (...args: unknown[]) => {
      this.captureConsole("error", args);
      this.originalConsoleError(...args);
    };

    console.warn = (...args: unknown[]) => {
      this.captureConsole("warn", args);
      this.originalConsoleWarn(...args);
    };
  }

  private captureFromEvent(
    error: unknown,
    source: "unhandled" | "promise",
    extras: Partial<ErrorReport> = {},
  ): void {
    const message =
      error instanceof Error ? error.message : String(error) || `${source} error`;
    const stack = error instanceof Error ? error.stack : undefined;
    const type = error instanceof Error ? error.name : "Error";

    this.add({
      id: this.makeId(),
      message,
      stack,
      type,
      timestamp: Date.now(),
      source,
      ...extras,
    });
  }

  private captureConsole(level: "error" | "warn", args: unknown[]): void {
    const message = args
      .map((a) => (typeof a === "string" ? a : safeStringify(a)))
      .join(" ");
    if (!message.trim()) return;

    this.add({
      id: this.makeId(),
      message: `[console.${level}] ${message}`,
      type: level === "warn" ? "warn" : "console",
      timestamp: Date.now(),
      source: "console",
    });
  }

  private add(report: ErrorReport): void {
    if (this.destroyed) return;

    this.buffer.push(report);
    if (this.buffer.length > (this.config.maxBufferSize ?? 100)) {
      this.buffer.shift();
    }

    this.renderPanel();

    if (this.config.onReport) {
      try { this.config.onReport(report); } catch { /* noop */ }
    }
    if (this.config.endpoint) {
      void this.postReport(report);
    }
    if (this.config.debug) {
      this.originalConsoleLog("[ErrorLogger]", report);
    }
  }

  private async postReport(report: ErrorReport): Promise<void> {
    if (!this.config.endpoint) return;
    try {
      await fetch(this.config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ errors: [report] }),
      });
    } catch {
      /* swallow — the logger never throws */
    }
  }

  private renderPanel(): void {
    if (!this.list) return;
    this.list.innerHTML = this.buffer
      .slice(-10)
      .reverse()
      .map((report) => this.renderEntry(report))
      .join("");

    if (this.badge) {
      const count = this.buffer.length;
      this.badge.textContent = count > 0 ? String(count) : "0";
      this.badge.dataset.hasErrors = count > 0 ? "true" : "false";
    }
  }

  private renderEntry(report: ErrorReport): string {
    const color = TYPE_COLORS[report.type] ?? "#97abc7";
    const time = new Date(report.timestamp).toLocaleTimeString();
    const stackSnippet = report.stack
      ? report.stack.split("\n").slice(0, 3).join("\n")
      : "";
    return `
      <div class="error-entry" data-source="${report.source}">
        <div class="error-entry__head">
          <span class="error-entry__type" style="color:${color}">${escapeHtml(report.type)}</span>
          <span class="error-entry__time">${escapeHtml(time)}</span>
        </div>
        <div class="error-entry__msg">${escapeHtml(report.message)}</div>
        ${stackSnippet ? `<pre class="error-entry__stack">${escapeHtml(stackSnippet)}</pre>` : ""}
      </div>
    `;
  }

  log(error: Error | string, context?: Record<string, unknown>): void {
    if (typeof error === "string") {
      this.add({
        id: this.makeId(),
        message: error,
        type: "manual",
        timestamp: Date.now(),
        source: "manual",
        context,
      });
      return;
    }
    this.add({
      id: this.makeId(),
      message: error.message,
      stack: error.stack,
      type: error.name,
      timestamp: Date.now(),
      source: "manual",
      context,
    });
  }

  logMessage(message: string, context?: Record<string, unknown>): void {
    this.add({
      id: this.makeId(),
      message,
      type: "manual",
      timestamp: Date.now(),
      source: "manual",
      context,
    });
  }

  getReports(): readonly ErrorReport[] {
    return this.buffer;
  }

  clear(): void {
    this.buffer = [];
    this.renderPanel();
  }

  destroy(): void {
    this.destroyed = true;
    if (typeof window !== "undefined") {
      window.removeEventListener("error", this.handleError);
      window.removeEventListener("unhandledrejection", this.handleRejection);
    }
    console.error = this.originalConsoleError;
    console.warn = this.originalConsoleWarn;
    if (this.originalConsoleLog) {
      console.log = this.originalConsoleLog;
    }
  }

  private handleError = (_event: ErrorEvent): void => {};
  private handleRejection = (_event: PromiseRejectionEvent): void => {};

  private makeId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

let instance: ErrorLogger | null = null;

export function initializeErrorLogger(
  config: ErrorLoggerConfig = {},
): ErrorLogger {
  if (instance) instance.destroy();
  instance = new ErrorLogger(config);
  return instance;
}

export function getErrorLogger(): ErrorLogger | null {
  return instance;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
