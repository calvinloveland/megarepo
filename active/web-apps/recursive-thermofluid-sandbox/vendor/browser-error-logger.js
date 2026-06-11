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
    function scheduleFlush() {
        if (flushTimer || isDestroyed)
            return;
        flushTimer = window.setTimeout(async () => {
            await flush();
        }, config.flushInterval || 5000);
    }
    async function flush() {
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        if (buffer.length === 0 || isDestroyed)
            return;
        const errorsToSend = buffer.splice(0, buffer.length);
        try {
            await sendErrors(errorsToSend, config);
            config.onSuccess?.(errorsToSend);
        }
        catch (error) {
            buffer.unshift(...errorsToSend);
            config.onError?.(error, errorsToSend);
        }
    }
    function addError(errorReport) {
        if (isDestroyed)
            return;
        const shouldSend = config.filter ? config.filter(errorReport) : true;
        if (!shouldSend)
            return;
        const transformedError = config.transform
            ? config.transform(errorReport)
            : errorReport;
        buffer.push(transformedError);
        if (buffer.length >= (config.batchSize || 10)) {
            void flush();
        }
        else {
            scheduleFlush();
        }
    }
    function log(error, context = {}) {
        const errorInput = {
            message: error.message,
            stack: error.stack,
            type: error.name,
            source: 'manual',
            context,
        };
        const errorReport = createErrorReport(errorInput, config);
        addError(errorReport);
    }
    function logMessage(message, context = {}) {
        const errorInput = {
            message,
            type: 'Message',
            source: 'manual',
            context,
        };
        const errorReport = createErrorReport(errorInput, config);
        addError(errorReport);
    }
    function handleError(event) {
        const errorInput = {
            message: event.message,
            stack: event.error?.stack,
            type: event.error?.name || 'Error',
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
            source: 'unhandled',
        };
        const errorReport = createErrorReport(errorInput, config);
        addError(errorReport);
    }
    function handlePromiseRejection(event) {
        const error = event.reason instanceof Error
            ? event.reason
            : new Error(String(event.reason));
        const errorInput = {
            message: error.message,
            stack: error.stack,
            type: error.name,
            source: 'unhandledrejection',
        };
        const errorReport = createErrorReport(errorInput, config);
        addError(errorReport);
    }
    function handleConsoleError(...args) {
        const message = args.map(String).join(' ');
        const errorInput = {
            message,
            type: 'ConsoleError',
            source: 'console.error',
        };
        const errorReport = createErrorReport(errorInput, config);
        addError(errorReport);
        originalConsoleError?.(...args);
    }
    if (config.captureUnhandled !== false) {
        window.addEventListener('error', handleError);
    }
    if (config.capturePromiseRejections !== false) {
        window.addEventListener('unhandledrejection', handlePromiseRejection);
    }
    if (config.captureConsoleErrors) {
        originalConsoleError = console.error;
        console.error = handleConsoleError;
    }
    if (config.debug) {
        logMessage('Browser Error Logger initialized', { config });
    }
    return {
        log,
        logMessage,
        flush,
        destroy() {
            isDestroyed = true;
            if (flushTimer) {
                clearTimeout(flushTimer);
                flushTimer = null;
            }
            if (config.captureUnhandled !== false) {
                window.removeEventListener('error', handleError);
            }
            if (config.capturePromiseRejections !== false) {
                window.removeEventListener('unhandledrejection', handlePromiseRejection);
            }
            if (config.captureConsoleErrors && originalConsoleError) {
                console.error = originalConsoleError;
            }
        },
    };
}