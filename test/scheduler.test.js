// ==============================
// Tests for scheduler.js - startScheduler
// ==============================

describe('scheduler.js', () => {
  let mockRunCycle;
  let mockDexPriceChecker;
  let mockConfig;
  let mockCtx;
  let setTimeoutSpy;
  let consoleLogSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    mockRunCycle = jest.fn().mockResolvedValue(undefined);
    mockDexPriceChecker = {
      type: 'dex_price',
      runCycle: mockRunCycle,
    };
    mockConfig = {
      dexPrice: {
        intervalMs: 1000,
        batchSize: 5,
        batchDelayMs: 100,
      },
    };
    mockCtx = { shuttingDown: false, isChecking: false };
    setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    
    jest.mock('../config', () => mockConfig);
    jest.mock('../checkers/dexPriceChecker', () => mockDexPriceChecker);
  });

  afterEach(() => {
    setTimeoutSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    jest.clearAllMocks();
    jest.resetModules();
  });

  test('checkers array contains dex_price checker', () => {
    const { checkers } = require('../scheduler');
    expect(checkers).toHaveLength(1);
    expect(checkers[0].type).toBe('dex_price');
  });

  test('startScheduler starts checker loop', async () => {
    const { startScheduler } = require('../scheduler');
    startScheduler(mockCtx);
    
    expect(mockRunCycle).toHaveBeenCalledWith(mockCtx);
  });

  test('startScheduler respects shuttingDown flag', async () => {
    const { startScheduler } = require('../scheduler');
    mockCtx.shuttingDown = true;
    
    startScheduler(mockCtx);
    
    expect(mockRunCycle).not.toHaveBeenCalled();
  });

  test('startScheduler handles errors gracefully', async () => {
    mockRunCycle.mockRejectedValueOnce(new Error('Cycle error'));
    
    const { startScheduler } = require('../scheduler');
    startScheduler(mockCtx);
    
    // Wait a tick for the async error to be caught
    await new Promise(resolve => setImmediate(resolve));
    
    expect(consoleErrorSpy).toHaveBeenCalledWith('dex_price checker error:', expect.any(Error));
  });
});
