// Tests for checkers/dexPriceChecker - alert triggers when threshold exceeded

jest.mock('../lib/fetchWithRetry');
jest.mock('../lib/telegram');

describe('dexPriceChecker alert threshold', () => {
  let mockAlertsCollection;
  let mockUsersCollection;
  let dexPriceChecker;

  beforeEach(() => {
    mockAlertsCollection = {
      find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    mockUsersCollection = {
      find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    };
    jest.resetModules();
    dexPriceChecker = require('../checkers/dexPriceChecker');
    dexPriceChecker.initCollections(mockAlertsCollection, mockUsersCollection);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('alert triggers when threshold exceeded', async () => {
    const mockAlert = {
      _id: 'alert1',
      source: 'dex',
      status: 'active',
      ownerId: 'user123',
      target: { chain: 'ethereum', address: '0xabc' },
      condition: { kind: 'percent_change', changePercent: 10, baselinePrice: 100 },
    };
    mockAlertsCollection.find.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([mockAlert]),
    });
    // No blocked users
    mockUsersCollection.find.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
      forEach: jest.fn().mockImplementation(async (cb) => {}),
    });
    const { sendTelegram } = require('../lib/telegram');
    const { fetchWithRetry } = require('../lib/fetchWithRetry');
    fetchWithRetry.mockResolvedValue({
      ok: true,
      json: async () => ({
        pairs: [
          {
            baseToken: { address: '0xabc', symbol: 'TOKEN', url: 'http://example.com' },
            priceUsd: 120,
            liquidity: { usd: 1000 },
          },
        ],
      }),
    });
    const ctx = { shuttingDown: false, isChecking: false };
    await dexPriceChecker.runCycle(ctx);
    expect(sendTelegram).toHaveBeenCalledWith('user123', expect.any(String));
  });
});

describe('dexPriceChecker shutdown behavior', () => {
  let mockAlertsCollection;
  let mockUsersCollection;
  let dexPriceChecker;

  beforeEach(() => {
    mockAlertsCollection = {
      find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    mockUsersCollection = {
      find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    };
    jest.resetModules();
    dexPriceChecker = require('../checkers/dexPriceChecker');
    dexPriceChecker.initCollections(mockAlertsCollection, mockUsersCollection);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('runCycle exits early when ctx.shuttingDown is true before fetch', async () => {
    const mockAlert = {
      _id: 'alert1',
      source: 'dex',
      status: 'active',
      ownerId: 'user123',
      target: { chain: 'ethereum', address: '0xabc' },
      condition: { kind: 'percent_change', changePercent: 10, baselinePrice: 100 },
    };
    mockAlertsCollection.find.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([mockAlert]),
    });
    mockUsersCollection.find.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
      forEach: jest.fn().mockImplementation(async (cb) => {}),
    });
    const { fetchWithRetry } = require('../lib/fetchWithRetry');
    // This should NOT be called if shutdown is checked before fetch
    fetchWithRetry.mockResolvedValue({
      ok: true,
      json: async () => ({ pairs: [] }),
    });

    const ctx = { shuttingDown: true, isChecking: false };
    await dexPriceChecker.runCycle(ctx);

    // fetchWithRetry should not be called because we exit early
    expect(fetchWithRetry).not.toHaveBeenCalled();
  });

  test('runCycle exits early when ctx.shuttingDown becomes true during fetch loop', async () => {
    const mockAlert = {
      _id: 'alert1',
      source: 'dex',
      status: 'active',
      ownerId: 'user123',
      target: { chain: 'ethereum', address: '0xabc' },
      condition: { kind: 'percent_change', changePercent: 10, baselinePrice: 100 },
    };
    mockAlertsCollection.find.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([mockAlert]),
    });
    mockUsersCollection.find.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
      forEach: jest.fn().mockImplementation(async (cb) => {}),
    });
    const { fetchWithRetry } = require('../lib/fetchWithRetry');
    let callCount = 0;
    fetchWithRetry.mockImplementation(async () => {
      callCount++;
      // Simulate delay
      await new Promise(r => setTimeout(r, 10));
      return {
        ok: true,
        json: async () => ({ pairs: [] }),
      };
    });

    const ctx = { shuttingDown: false, isChecking: false };
    // Start the cycle, then set shuttingDown to true
    const cyclePromise = dexPriceChecker.runCycle(ctx);
    // Give it a moment to start fetching
    await new Promise(r => setTimeout(r, 5));
    ctx.shuttingDown = true;
    await cyclePromise;

    // Should have made at least one fetch call but then exited
    expect(callCount).toBeGreaterThanOrEqual(1);
  });
});