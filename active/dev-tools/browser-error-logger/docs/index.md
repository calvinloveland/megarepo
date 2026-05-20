# Browser Error Logger

A lightweight TypeScript library for capturing JavaScript errors in the browser and sending them to a server endpoint.

## Features

- **Automatic Error Capture**: Catches unhandled errors and promise rejections
- **Batching**: Buffers errors and sends in batches to reduce network requests
- **Filtering**: Skip specific errors with custom filter functions
- **Transform**: Modify error data before sending
- **Manual Logging**: Log errors and messages programmatically
- **TypeScript First**: Full type definitions included
- **Zero Dependencies**: Only uses browser APIs

## Installation

```bash
npm install browser-error-logger
```

Or for local development:
```bash
npm link /path/to/browser-error-logger
```

## Usage

### Basic Setup

```typescript
import { createErrorLogger } from 'browser-error-logger';

const logger = createErrorLogger({
  endpoint: 'https://your-server.com/api/errors',
  appName: 'MyApp',
  appVersion: '1.0.0',
});

// Errors are now automatically captured and batched
```

### Configuration Options

```typescript
interface ErrorLoggerConfig {
  // Required
  endpoint: string;              // Server endpoint to send errors

  // Optional
  appName?: string;              // Application identifier
  appVersion?: string;           // Application version
  captureUnhandled?: boolean;    // Capture window.onerror (default: true)
  capturePromiseRejections?: boolean; // Capture unhandled rejections (default: true)
  captureConsoleErrors?: boolean; // Capture console.error (default: false)
  batchSize?: number;            // Max errors before auto-flush (default: 10)
  flushInterval?: number;        // Auto-flush interval in ms (default: 5000)
  headers?: Record<string, string>; // Custom HTTP headers
  filter?: (error: ErrorReport) => boolean;  // Filter out errors
  transform?: (error: ErrorReport) => ErrorReport; // Transform errors
  onSuccess?: (errors: ErrorReport[]) => void; // Success callback
  onError?: (error: Error, reports: ErrorReport[]) => void; // Error callback
  debug?: boolean;               // Log to console (default: false)
}
```

### Manual Error Logging

```typescript
// Log an Error object
try {
  riskyOperation();
} catch (err) {
  logger.log(err as Error, { action: 'riskyOperation' });
}

// Log a message
logger.logMessage('Something unexpected happened', {
  userId: currentUser.id,
});
```

### Force Flush

```typescript
// Send all buffered errors immediately
await logger.flush();
```

### Cleanup

```typescript
// Stop capturing and clean up
logger.destroy();
```

### Filtering Errors

```typescript
const logger = createErrorLogger({
  endpoint: '/api/errors',
  filter: (report) => {
    // Skip ResizeObserver errors
    if (report.message.includes('ResizeObserver')) {
      return false;
    }
    // Skip errors from browser extensions
    if (report.filename?.includes('chrome-extension://')) {
      return false;
    }
    return true;
  },
});
```

### Transforming Errors

```typescript
const logger = createErrorLogger({
  endpoint: '/api/errors',
  transform: (report) => ({
    ...report,
    // Add custom data
    context: {
      ...report.context,
      sessionId: getSessionId(),
      userId: getCurrentUserId(),
    },
    // Sanitize sensitive data
    url: report.url.replace(/token=\w+/, 'token=REDACTED'),
  }),
});
```

## Server Endpoint

The logger sends POST requests with the following payload:

```json
{
  "errors": [
    {
      "id": "1701234567890-abc123def",
      "message": "Cannot read property 'x' of undefined",
      "stack": "TypeError: Cannot read property 'x' of undefined\n    at ...",
      "type": "TypeError",
      "filename": "https://example.com/app.js",
      "lineno": 42,
      "colno": 15,
      "timestamp": 1701234567890,
      "source": "unhandled",
      "url": "https://example.com/page",
      "userAgent": "Mozilla/5.0 ...",
      "appName": "MyApp",
      "appVersion": "1.0.0",
      "context": {}
    }
  ]
}
```

Example Express handler:

```typescript
app.post('/api/errors', (req, res) => {
  const { errors } = req.body;
  
  for (const error of errors) {
    console.error(`[${error.appName}] ${error.type}: ${error.message}`);
    // Store in database, send to logging service, etc.
  }
  
  res.sendStatus(200);
});
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Watch mode
npm run test:watch
```

## License

MIT
