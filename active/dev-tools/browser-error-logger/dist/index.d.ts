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
 * Create an error report from various inputs
 */
export declare function createErrorReport(input: {
    message: string;
    stack?: string;
    type?: string;
    filename?: string;
    lineno?: number;
    colno?: number;
    source: ErrorReport['source'];
    context?: Record<string, unknown>;
}, config: Pick<ErrorLoggerConfig, 'appName' | 'appVersion'>): ErrorReport;
/**
 * Create and initialize an error logger
 */
export declare function createErrorLogger(config: ErrorLoggerConfig): ErrorLogger;
export default createErrorLogger;
//# sourceMappingURL=index.d.ts.map