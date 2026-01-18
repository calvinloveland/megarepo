/**
 * Browser Error Logger - Integration for HiveMind
 * 
 * Captures JavaScript errors and sends them to the coordinator for debugging.
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
  source: 'unhandled' | 'promise' | 'console' | 'manual';
  url: string;
  userAgent: string;
  context?: Record<string, unknown>;
}

interface ErrorLoggerConfig {
  endpoint: string;
  debug?: boolean;
  batchSize?: number;
  flushInterval?: number;
}

class ErrorLogger {
  private buffer: ErrorReport[] = [];
  private config: ErrorLoggerConfig;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(config: ErrorLoggerConfig) {
    this.config = {
      batchSize: 10,
      flushInterval: 5000,
      ...config,
    };

    // Setup global error handlers
    window.addEventListener('error', this.handleError);
    window.addEventListener('unhandledrejection', this.handleRejection);

    // Setup periodic flush
    if (this.config.flushInterval && this.config.flushInterval > 0) {
      this.flushTimer = setInterval(() => this.flush(), this.config.flushInterval);
    }

    if (this.config.debug) {
      console.log('[ErrorLogger] Initialized');
    }
  }

  private handleError = (event: ErrorEvent) => {
    const report = this.createReport({
      message: event.message || 'Unknown error',
      stack: event.error?.stack,
      type: event.error?.name || 'Error',
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      source: 'unhandled',
    });

    this.addToBuffer(report);
  };

  private handleRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const report = this.createReport({
      message: reason?.message || String(reason) || 'Unhandled promise rejection',
      stack: reason?.stack,
      type: reason?.name || 'UnhandledRejection',
      source: 'promise',
    });

    this.addToBuffer(report);
  };

  private createReport(input: Partial<ErrorReport> & { message: string; source: ErrorReport['source'] }): ErrorReport {
    return {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      message: input.message,
      stack: input.stack,
      type: input.type || 'Error',
      filename: input.filename,
      lineno: input.lineno,
      colno: input.colno,
      timestamp: Date.now(),
      source: input.source,
      url: window.location.href,
      userAgent: navigator.userAgent,
      context: input.context,
    };
  }

  private addToBuffer(report: ErrorReport) {
    if (this.destroyed) return;

    if (this.config.debug) {
      console.log('[ErrorLogger] Captured:', report.type, report.message);
      if (report.stack) {
        console.log('[ErrorLogger] Stack:', report.stack);
      }
    }

    this.buffer.push(report);

    if (this.buffer.length >= (this.config.batchSize || 10)) {
      this.flush();
    }
  }

  log(error: Error, context?: Record<string, unknown>) {
    const report = this.createReport({
      message: error.message,
      stack: error.stack,
      type: error.name,
      source: 'manual',
      context,
    });
    this.addToBuffer(report);
  }

  logMessage(message: string, context?: Record<string, unknown>) {
    const report = this.createReport({
      message,
      source: 'manual',
      context,
    });
    this.addToBuffer(report);
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const errors = [...this.buffer];
    this.buffer = [];

    try {
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ errors }),
      });

      if (!response.ok) {
        throw new Error(`Failed to send: ${response.status}`);
      }

      if (this.config.debug) {
        console.log(`[ErrorLogger] Flushed ${errors.length} errors`);
      }
    } catch (err) {
      // Restore to buffer on failure
      this.buffer = [...errors, ...this.buffer];
      if (this.config.debug) {
        console.error('[ErrorLogger] Failed to flush:', err);
      }
    }
  }

  destroy() {
    this.destroyed = true;
    window.removeEventListener('error', this.handleError);
    window.removeEventListener('unhandledrejection', this.handleRejection);
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.flush();
  }
}

// Singleton instance
let instance: ErrorLogger | null = null;

export function initializeErrorLogger(config: ErrorLoggerConfig): ErrorLogger {
  if (instance) {
    instance.destroy();
  }
  instance = new ErrorLogger(config);
  return instance;
}

let webgpuListenerRegistered = false;

export function registerWebGPUErrorListener(): void {
  if (webgpuListenerRegistered) return;
  if (typeof GPUAdapter === 'undefined') return;

  const originalRequestDevice = GPUAdapter.prototype.requestDevice;

  GPUAdapter.prototype.requestDevice = async function (...args) {
    const device = await originalRequestDevice.apply(this, args as [GPUDeviceDescriptor]);
    device.addEventListener('uncapturederror', (event: GPUUncapturedErrorEvent) => {
      const message = event.error?.message || 'Unknown WebGPU error';
      const name = event.error?.name || 'GPUError';
      instance?.logMessage(`WebGPU: ${message}`, { type: name });
      console.error('[WebGPU] Uncaptured error:', event.error);
    });
    return device;
  };

  webgpuListenerRegistered = true;
}

export function getErrorLogger(): ErrorLogger | null {
  return instance;
}

export { ErrorLogger };
