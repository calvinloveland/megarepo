import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createErrorLogger,
  createErrorReport,
  ErrorLoggerConfig,
  ErrorReport,
  ErrorLogger,
} from './index';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock window and navigator for browser environment
const mockWindow = {
  location: { href: 'http://localhost:5173/test' },
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

const mockNavigator = {
  userAgent: 'Mozilla/5.0 TestBrowser',
};

// Setup global mocks
vi.stubGlobal('window', mockWindow);
vi.stubGlobal('navigator', mockNavigator);

describe('createErrorReport', () => {
  it('should create a valid error report', () => {
    const report = createErrorReport(
      {
        message: 'Test error',
        stack: 'Error: Test error\n    at test.js:1:1',
        type: 'TypeError',
        filename: 'test.js',
        lineno: 1,
        colno: 1,
        source: 'unhandled',
      },
      { appName: 'TestApp', appVersion: '1.0.0' }
    );

    expect(report.message).toBe('Test error');
    expect(report.stack).toBe('Error: Test error\n    at test.js:1:1');
    expect(report.type).toBe('TypeError');
    expect(report.filename).toBe('test.js');
    expect(report.lineno).toBe(1);
    expect(report.colno).toBe(1);
    expect(report.source).toBe('unhandled');
    expect(report.appName).toBe('TestApp');
    expect(report.appVersion).toBe('1.0.0');
    expect(report.url).toBe('http://localhost:5173/test');
    expect(report.userAgent).toBe('Mozilla/5.0 TestBrowser');
    expect(report.id).toBeDefined();
    expect(report.timestamp).toBeGreaterThan(0);
  });

  it('should use default type if not provided', () => {
    const report = createErrorReport(
      {
        message: 'Test error',
        source: 'manual',
      },
      {}
    );

    expect(report.type).toBe('Error');
  });

  it('should include context data', () => {
    const report = createErrorReport(
      {
        message: 'Test error',
        source: 'manual',
        context: { userId: '123', action: 'click' },
      },
      {}
    );

    expect(report.context).toEqual({ userId: '123', action: 'click' });
  });
});

describe('createErrorLogger', () => {
  let logger: ErrorLogger;
  const defaultConfig: ErrorLoggerConfig = {
    endpoint: 'http://localhost:5000/api/errors',
    appName: 'TestApp',
    appVersion: '1.0.0',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    logger?.destroy();
  });

  describe('initialization', () => {
    it('should create a logger with required config', () => {
      logger = createErrorLogger(defaultConfig);
      
      expect(logger).toBeDefined();
      expect(logger.log).toBeInstanceOf(Function);
      expect(logger.logMessage).toBeInstanceOf(Function);
      expect(logger.flush).toBeInstanceOf(Function);
      expect(logger.destroy).toBeInstanceOf(Function);
      expect(logger.getBufferSize).toBeInstanceOf(Function);
    });

    it('should register window error listener when captureUnhandled is true', () => {
      logger = createErrorLogger({ ...defaultConfig, captureUnhandled: true });
      
      expect(mockWindow.addEventListener).toHaveBeenCalledWith(
        'error',
        expect.any(Function)
      );
    });

    it('should register unhandledrejection listener when capturePromiseRejections is true', () => {
      logger = createErrorLogger({ ...defaultConfig, capturePromiseRejections: true });
      
      expect(mockWindow.addEventListener).toHaveBeenCalledWith(
        'unhandledrejection',
        expect.any(Function)
      );
    });

    it('should not register listeners when capture options are false', () => {
      vi.clearAllMocks();
      logger = createErrorLogger({
        ...defaultConfig,
        captureUnhandled: false,
        capturePromiseRejections: false,
      });
      
      expect(mockWindow.addEventListener).not.toHaveBeenCalled();
    });
  });

  describe('manual logging', () => {
    it('should log an Error object', () => {
      logger = createErrorLogger({ ...defaultConfig, batchSize: 100 });
      
      const error = new TypeError('Test type error');
      logger.log(error);
      
      expect(logger.getBufferSize()).toBe(1);
    });

    it('should log an error message', () => {
      logger = createErrorLogger({ ...defaultConfig, batchSize: 100 });
      
      logger.logMessage('Something went wrong');
      
      expect(logger.getBufferSize()).toBe(1);
    });

    it('should include context in logged errors', () => {
      logger = createErrorLogger({ ...defaultConfig, batchSize: 100 });
      
      const error = new Error('Test error');
      logger.log(error, { userId: '123' });
      
      expect(logger.getBufferSize()).toBe(1);
    });
  });

  describe('batching', () => {
    it('should buffer errors up to batchSize', () => {
      logger = createErrorLogger({ ...defaultConfig, batchSize: 3 });
      
      logger.logMessage('Error 1');
      logger.logMessage('Error 2');
      
      expect(logger.getBufferSize()).toBe(2);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should auto-flush when buffer reaches batchSize', async () => {
      logger = createErrorLogger({ ...defaultConfig, batchSize: 2, flushInterval: 0 });
      
      logger.logMessage('Error 1');
      logger.logMessage('Error 2');
      
      // Wait for async flush
      await vi.waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('flush', () => {
    it('should send buffered errors to endpoint', async () => {
      logger = createErrorLogger({ ...defaultConfig, batchSize: 100 });
      
      logger.logMessage('Error 1');
      logger.logMessage('Error 2');
      
      await logger.flush();
      
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/errors',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: expect.any(String),
        })
      );
      
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.errors).toHaveLength(2);
      expect(body.errors[0].message).toBe('Error 1');
      expect(body.errors[1].message).toBe('Error 2');
    });

    it('should clear buffer after successful flush', async () => {
      logger = createErrorLogger({ ...defaultConfig, batchSize: 100 });
      
      logger.logMessage('Error 1');
      await logger.flush();
      
      expect(logger.getBufferSize()).toBe(0);
    });

    it('should not send request if buffer is empty', async () => {
      logger = createErrorLogger(defaultConfig);
      
      await logger.flush();
      
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should include custom headers', async () => {
      logger = createErrorLogger({
        ...defaultConfig,
        headers: { 'X-API-Key': 'secret123' },
        batchSize: 100,
      });
      
      logger.logMessage('Error');
      await logger.flush();
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-API-Key': 'secret123',
          }),
        })
      );
    });

    it('should call onSuccess callback on successful flush', async () => {
      const onSuccess = vi.fn();
      logger = createErrorLogger({
        ...defaultConfig,
        onSuccess,
        batchSize: 100,
      });
      
      logger.logMessage('Error');
      await logger.flush();
      
      expect(onSuccess).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ message: 'Error' }),
        ])
      );
    });

    it('should call onError callback on failed flush', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      
      const onError = vi.fn();
      logger = createErrorLogger({
        ...defaultConfig,
        onError,
        batchSize: 100,
      });
      
      logger.logMessage('Error');
      await logger.flush();
      
      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.arrayContaining([
          expect.objectContaining({ message: 'Error' }),
        ])
      );
    });

    it('should restore errors to buffer on failed flush', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      
      logger = createErrorLogger({ ...defaultConfig, batchSize: 100 });
      
      logger.logMessage('Error');
      await logger.flush();
      
      expect(logger.getBufferSize()).toBe(1);
    });
  });

  describe('filtering', () => {
    it('should filter out errors when filter returns false', () => {
      logger = createErrorLogger({
        ...defaultConfig,
        batchSize: 100,
        filter: (report) => !report.message.includes('ignore'),
      });
      
      logger.logMessage('Normal error');
      logger.logMessage('Please ignore this');
      logger.logMessage('Another error');
      
      expect(logger.getBufferSize()).toBe(2);
    });

    it('should include errors when filter returns true', () => {
      logger = createErrorLogger({
        ...defaultConfig,
        batchSize: 100,
        filter: () => true,
      });
      
      logger.logMessage('Error 1');
      logger.logMessage('Error 2');
      
      expect(logger.getBufferSize()).toBe(2);
    });
  });

  describe('transform', () => {
    it('should transform errors before buffering', async () => {
      logger = createErrorLogger({
        ...defaultConfig,
        batchSize: 100,
        transform: (report) => ({
          ...report,
          message: `[Transformed] ${report.message}`,
        }),
      });
      
      logger.logMessage('Original message');
      await logger.flush();
      
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.errors[0].message).toBe('[Transformed] Original message');
    });
  });

  describe('destroy', () => {
    it('should remove event listeners on destroy', () => {
      logger = createErrorLogger({
        ...defaultConfig,
        captureUnhandled: true,
        capturePromiseRejections: true,
      });
      
      logger.destroy();
      
      expect(mockWindow.removeEventListener).toHaveBeenCalledWith(
        'error',
        expect.any(Function)
      );
      expect(mockWindow.removeEventListener).toHaveBeenCalledWith(
        'unhandledrejection',
        expect.any(Function)
      );
    });

    it('should stop accepting new errors after destroy', () => {
      logger = createErrorLogger({ ...defaultConfig, batchSize: 100 });
      
      logger.logMessage('Before destroy');
      expect(logger.getBufferSize()).toBe(1);
      
      logger.destroy();
      
      logger.logMessage('After destroy');
      expect(logger.getBufferSize()).toBe(1); // Still 1, not 2
    });
  });
});

describe('edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true });
  });

  it('should handle non-ok response status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error' });
    
    const onError = vi.fn();
    const logger = createErrorLogger({
      endpoint: 'http://localhost:5000/api/errors',
      onError,
      batchSize: 100,
    });
    
    logger.logMessage('Error');
    await logger.flush();
    
    expect(onError).toHaveBeenCalled();
    logger.destroy();
  });

  it('should generate unique IDs for each error', () => {
    const report1 = createErrorReport({ message: 'Error 1', source: 'manual' }, {});
    const report2 = createErrorReport({ message: 'Error 2', source: 'manual' }, {});
    
    expect(report1.id).not.toBe(report2.id);
  });
});
