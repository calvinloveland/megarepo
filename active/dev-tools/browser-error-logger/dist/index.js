/**
 * Browser Error Logger
 *
 * A lightweight library for capturing JavaScript errors in the browser
 * and sending them to a server endpoint.
 */
/**
 * Generate a unique ID
 */
function generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
/**
 * Safely get the current URL
 */
function getCurrentUrl() {
    try {
        return typeof window !== 'undefined' ? window.location.href : 'unknown';
    }
    catch {
        return 'unknown';
    }
}
/**
 * Safely get user agent
 */
function getUserAgent() {
    try {
        return typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
    }
    catch {
        return 'unknown';
    }
}
/**
 * Create an error report from various inputs
 */
export function createErrorReport(input, config) {
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
async function sendErrors(errors, config) {
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
export function createErrorLogger(config) {
    const buffer = [];
    let flushTimer = null;
    let isDestroyed = false;
    // Original console.error for restoration
    let originalConsoleError = null;
    const { captureUnhandled = true, capturePromiseRejections = true, captureConsoleErrors = false, batchSize = 10, flushInterval = 5000, filter, transform, onSuccess, onError, debug = false, } = config;
    function debugLog(...args) {
        if (debug) {
            console.log('[ErrorLogger]', ...args);
        }
    }
    function addToBuffer(report) {
        if (isDestroyed)
            return;
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
            flush().catch(() => { });
        }
    }
    async function flush() {
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
        }
        catch (error) {
            debugLog('Failed to send errors:', error);
            // Put errors back in buffer for retry
            buffer.unshift(...errorsToSend);
            onError?.(error, errorsToSend);
        }
    }
    // Handler for window.onerror
    function handleWindowError(event, source, lineno, colno, error) {
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
    function handleUnhandledRejection(event) {
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
            window.addEventListener('error', handleWindowError);
            debugLog('Listening for unhandled errors');
        }
        if (capturePromiseRejections) {
            window.addEventListener('unhandledrejection', handleUnhandledRejection);
            debugLog('Listening for unhandled promise rejections');
        }
        if (captureConsoleErrors) {
            originalConsoleError = console.error;
            console.error = (...args) => {
                // Call original first
                originalConsoleError?.apply(console, args);
                // Create error report
                const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ');
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
            flush().catch(() => { });
        }, flushInterval);
        debugLog(`Flush interval set to ${flushInterval}ms`);
    }
    // Return the logger interface
    return {
        log(error, context) {
            const report = createErrorReport({
                message: error.message,
                stack: error.stack,
                type: error.name,
                source: 'manual',
                context,
            }, config);
            addToBuffer(report);
        },
        logMessage(message, context) {
            const report = createErrorReport({
                message,
                type: 'ManualLog',
                source: 'manual',
                context,
            }, config);
            addToBuffer(report);
        },
        async flush() {
            return flush();
        },
        destroy() {
            isDestroyed = true;
            if (flushTimer) {
                clearInterval(flushTimer);
                flushTimer = null;
            }
            if (typeof window !== 'undefined') {
                if (captureUnhandled) {
                    window.removeEventListener('error', handleWindowError);
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
        getBufferSize() {
            return buffer.length;
        },
    };
}
// Default export
export default createErrorLogger;
//# sourceMappingURL=index.js.map