/**
 * Error Logger Tests
 * 
 * Tests for the browser error logging utility.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initializeErrorLogger, getErrorLogger, ErrorLogger } from '../utils/errorLogger';

// Mock fetch
const mockFetch = vi.fn().mockResolvedValue({ ok: true });
globalThis.fetch = mockFetch;

describe('ErrorLogger', () => {
  let logger: ErrorLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    // Create a fresh logger for each test
    logger = initializeErrorLogger({
      endpoint: 'http://localhost:5000/api/errors',
      debug: false,
      batchSize: 10,
      flushInterval: 0, // Disable auto-flush for tests
    });
  });

  afterEach(() => {
    logger.destroy();
  });

  it('should create a logger instance', () => {
    expect(logger).toBeDefined();
    expect(logger.log).toBeInstanceOf(Function);
    expect(logger.logMessage).toBeInstanceOf(Function);
    expect(logger.flush).toBeInstanceOf(Function);
  });

  it('should be retrievable via getErrorLogger', () => {
    const retrieved = getErrorLogger();
    expect(retrieved).toBe(logger);
  });

  it('should log an error', async () => {
    const error = new Error('Test error');
    logger.log(error);
    
    await logger.flush();
    
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.errors[0].message).toBe('Test error');
  });

  it('should log a message', async () => {
    logger.logMessage('Something happened');
    
    await logger.flush();
    
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.errors[0].message).toBe('Something happened');
  });

  it('should include context with logged errors', async () => {
    logger.log(new Error('Test'), { userId: '123', action: 'test' });
    
    await logger.flush();
    
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.errors[0].context).toEqual({ userId: '123', action: 'test' });
  });

  it('should batch multiple errors', async () => {
    logger.logMessage('Error 1');
    logger.logMessage('Error 2');
    logger.logMessage('Error 3');
    
    await logger.flush();
    
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.errors).toHaveLength(3);
  });

  it('should not flush when no errors buffered', async () => {
    await logger.flush();
    
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should stop accepting errors after destroy', async () => {
    logger.logMessage('Before destroy');
    logger.destroy();
    logger.logMessage('After destroy');
    
    // Force a new logger to flush any remaining
    const newLogger = initializeErrorLogger({
      endpoint: 'http://localhost:5000/api/errors',
      batchSize: 10,
    });
    
    // Only one error should have been logged (the one before destroy)
    expect(mockFetch).toHaveBeenCalledTimes(1); // From destroy's auto-flush
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].message).toBe('Before destroy');
    
    newLogger.destroy();
  });
});
