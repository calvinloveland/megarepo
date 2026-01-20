/**
 * Browser Error Logger
 * 
 * A lightweight library for capturing JavaScript errors in the browser
 * and sending them to a server endpoint.
 */

export interface ErrorLoggerConfig {
  /** Server endpoint to send errors to */
  endpoint: string;
  
  /** Application identifier */
  appName?: string;
  
  /** Application version */
  appVersion?: string;
  
  /** Whether to capture unhandled errors (default: true) */
  captureUnhandled?: boolean;
  
  /** Whether to capture unhandled promise rejections (default: true) */
  capturePromiseRejections?: boolean;
  
  /** Whether to capture console.error calls (default: false) */
  captureConsoleErrors?: boolean;
  
  /** Maximum errors to buffer before sending (default: 10) */
  batchSize?: number;
  
  /** Flush interval in ms (default: 5000) */
  flushInterval?: number;
  
  /** Custom headers for the endpoint request */
  headers?: Record<string, string>;
  
  /** Filter function - return false to skip logging an error */
  filter?: (error: ErrorReport) => boolean;
  
  /** Transform function - modify error before sending */
  transform?: (error: ErrorReport) => ErrorReport;
  
  /** Called when errors are successfully sent */
  onSuccess?: (errors: ErrorReport[]) => void;
  
  /** Called when sending errors fails */
  onError?: (error: Error, reports: ErrorReport[]) => void;
  
  /** Enable debug mode (logs to console) */
  debug?: boolean;
}

export interface ErrorReport {
  /** Unique error ID */
  id: string;
  
  /** Error message */
  message: string;
  
  /** Error stack trace */
  stack?: string;
  
  /** Error type/name */
  type: string;
  
  /** Source file where error occurred */
  filename?: string;
  
  /** Line number */
  lineno?: number;
  
  /** Column number */
  colno?: number;
  
  /** Timestamp when error occurred */
  timestamp: number;
  
  /** How the error was captured */
  source: 'unhandled' | 'promise' | 'console' | 'manual';
  
  /** Current page URL */
  url: string;
  
  /** User agent string */
  userAgent: string;
  
  /** Application name */
  appName?: string;
  
  /** Application version */
  appVersion?: string;
  
  /** Additional context data */
  context?: Record<string, unknown>;
}

export interface ErrorLogger {
  /** Manually log an error */
  log(error: Error, context?: Record<string, unknown>): void;
  
  /** Manually log a message as an error */
  logMessage(message: string, context?: Record<string, unknown>): void;
  
  /** Force flush any buffered errors */
  flush(): Promise<void>;
  
  /** Stop the logger and clean up */
  destroy(): void;
  
  /** Get count of buffered errors */
  getBufferSize(): number;
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Safely get the current URL
 */
function getCurrentUrl(): string {
  try {
    return typeof window !== 'undefined' ? window.location.href : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Safely get user agent
 */
function getUserAgent(): string {
  try {
    return typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Create an error report from various inputs
 */
export function createErrorReport(
  input: {
    message: string;
    stack?: string;
    type?: string;
    filename?: string;
    lineno?: number;
    colno?: number;
    source: ErrorReport['source'];
    context?: Record<string, unknown>;
  },
  config: Pick<ErrorLoggerConfig, 'appName' | 'appVersion'>
): ErrorReport {
  return {
    id: generateId(),
    message: input.message,
    stack: input.stack,
    type: input.type || 'Error',
    filename: input.filename,
    lineno: input.lineno,
    colno: input.colno,
    timestamp: Date.now(),
    source: input.source,
    url: getCurrentUrl(),
    userAgent: getUserAgent(),
    appName: config.appName,
    appVersion: config.appVersion,
    context: input.context,
  };
}

/**
 * Send errors to the server
 */
async function sendErrors(
  errors: ErrorReport[],
  config: ErrorLoggerConfig
): Promise<void> {
  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...config.headers,
    },
    body: JSON.stringify({ errors }),
  });

  if (!response.ok) {
    throw new Error(`Failed to send errors: ${response.status} ${response.statusText}`);
  }
}

/**
 * Create and initialize an error logger
 */
export function createErrorLogger(config: ErrorLoggerConfig): ErrorLogger {
  const buffer: ErrorReport[] = [];
  let flushTimer: ReturnType<typeof setInterval> | null = null;
  let isDestroyed = false;
  
  // Original console.error for restoration
  let originalConsoleError: typeof console.error | null = null;
  
  const {
    captureUnhandled = true,
    capturePromiseRejections = true,
    captureConsoleErrors = false,
    batchSize = 10,
    flushInterval = 5000,
    filter,
    transform,
    onSuccess,
    onError,
    debug = false,
  } = config;

  function debugLog(...args: unknown[]): void {
    if (debug) {
      console.log('[ErrorLogger]', ...args);
    }
  }

  function addToBuffer(report: ErrorReport): void {
    if (isDestroyed) return;
    
    // Apply filter
    if (filter && !filter(report)) {
      debugLog('Error filtered out:', report.message);
      return;
    }
    
    // Apply transform
    const finalReport = transform ? transform(report) : report;
    
    buffer.push(finalReport);
    debugLog('Error buffered:', finalReport.message, `(buffer size: ${buffer.length})`);
    
    // Flush if buffer is full
    if (buffer.length >= batchSize) {
      flush().catch(() => {});
    }
  }

  async function flush(): Promise<void> {
    if (buffer.length === 0) {
      debugLog('Flush called but buffer is empty');
      return;
    }
    
    const errorsToSend = [...buffer];
    buffer.length = 0;
    
    debugLog(`Flushing ${errorsToSend.length} errors to ${config.endpoint}`);
    
    try {
      await sendErrors(errorsToSend, config);
      debugLog('Errors sent successfully');
      onSuccess?.(errorsToSend);
    } catch (error) {
      debugLog('Failed to send errors:', error);
      // Put errors back in buffer for retry
      buffer.unshift(...errorsToSend);
      onError?.(error as Error, errorsToSend);
    }
  }

  // Handler for window.onerror
  function handleWindowError(
    event: Event | string,
    source?: string,
    lineno?: number,
    colno?: number,
    error?: Error
  ): void {
    const message = error?.message || (typeof event === 'string' ? event : 'Unknown error');
    const stack = error?.stack;
    
    const report = createErrorReport({
      message,
      stack,
      type: error?.name || 'Error',
      filename: source,
      lineno,
      colno,
      source: 'unhandled',
    }, config);
    
    addToBuffer(report);
  }

  // Handler for unhandled promise rejections
  function handleUnhandledRejection(event: PromiseRejectionEvent): void {
    const reason = event.reason;
    const message = reason instanceof Error 
      ? reason.message 
      : typeof reason === 'string' 
        ? reason 
        : 'Unhandled promise rejection';
    const stack = reason instanceof Error ? reason.stack : undefined;
    
    const report = createErrorReport({
      message,
      stack,
      type: reason instanceof Error ? reason.name : 'UnhandledRejection',
      source: 'promise',
    }, config);
    
    addToBuffer(report);
  }

  // Setup error handlers
  if (typeof window !== 'undefined') {
    if (captureUnhandled) {
      window.addEventListener('error', handleWindowError as EventListener);
      debugLog('Listening for unhandled errors');
    }
    
    if (capturePromiseRejections) {
      window.addEventListener('unhandledrejection', handleUnhandledRejection);
      debugLog('Listening for unhandled promise rejections');
    }
    
    if (captureConsoleErrors) {
      originalConsoleError = console.error;
      console.error = (...args: unknown[]) => {
        // Call original first
        originalConsoleError?.apply(console, args);
        
        // Create error report
        const message = args.map(arg => 
          typeof arg === 'string' ? arg : JSON.stringify(arg)
        ).join(' ');
        
        const report = createErrorReport({
          message,
          type: 'ConsoleError',
          source: 'console',
        }, config);
        
        addToBuffer(report);
      };
      debugLog('Intercepting console.error calls');
    }
  }

  // Start flush interval
  if (flushInterval > 0) {
    flushTimer = setInterval(() => {
      flush().catch(() => {});
    }, flushInterval);
    debugLog(`Flush interval set to ${flushInterval}ms`);
  }

  // Return the logger interface
  return {
    log(error: Error, context?: Record<string, unknown>): void {
      const report = createErrorReport({
        message: error.message,
        stack: error.stack,
        type: error.name,
        source: 'manual',
        context,
      }, config);
      
      addToBuffer(report);
    },

    logMessage(message: string, context?: Record<string, unknown>): void {
      const report = createErrorReport({
        message,
        type: 'ManualLog',
        source: 'manual',
        context,
      }, config);
      
      addToBuffer(report);
    },

    async flush(): Promise<void> {
      return flush();
    },

    destroy(): void {
      isDestroyed = true;
      
      if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = null;
      }
      
      if (typeof window !== 'undefined') {
        if (captureUnhandled) {
          window.removeEventListener('error', handleWindowError as EventListener);
        }
        
        if (capturePromiseRejections) {
          window.removeEventListener('unhandledrejection', handleUnhandledRejection);
        }
        
        if (captureConsoleErrors && originalConsoleError) {
          console.error = originalConsoleError;
        }
      }
      
      debugLog('Logger destroyed');
    },

    getBufferSize(): number {
      return buffer.length;
    },
  };
}

// Default export
export default createErrorLogger;
