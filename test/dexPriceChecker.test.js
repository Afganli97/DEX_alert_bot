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
