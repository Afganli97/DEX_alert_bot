// ==============================
// Tests for handlers/tokenCommands.js
// ==============================

const { initCollections, fetchTokenInfo } = require('../handlers/tokenCommands');

describe('tokenCommands.js', () => {
  let mockAlertsCollection;
  let mockUsersCollection;

  beforeEach(() => {
    mockAlertsCollection = { countDocuments: jest.fn() };
    mockUsersCollection = { findOne: jest.fn() };
    initCollections(mockAlertsCollection, mockUsersCollection);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchTokenInfo', () => {
    test('returns token info for valid address', async () => {
      const mockRes = {
        ok: true,
        status: 200,
        json: async () => ({
          pairs: [
            { baseToken: { symbol: 'ETH' }, chainId: 'ethereum', liquidity: { usd: 1000 } },
          ],
        }),
      };
      global.fetch = jest.fn().mockResolvedValue(mockRes);

      const result = await fetchTokenInfo('0x1234567890abcdef1234567890abcdef12345678');
      expect(result).toEqual({
        name: 'eth',
        chain: 'ethereum',
        address: '0x1234567890abcdef1234567890abcdef12345678',
      });
    });

    test('returns null when no pairs found', async () => {
      const mockRes = {
        ok: true,
        status: 200,
        json: async () => ({ pairs: [] }),
      };
      global.fetch = jest.fn().mockResolvedValue(mockRes);

      const result = await fetchTokenInfo('0x1234567890abcdef1234567890abcdef12345678');
      expect(result).toBe(null);
    });

    test('returns null on HTTP error', async () => {
      const mockRes = {
        ok: false,
        status: 404,
      };
      global.fetch = jest.fn().mockResolvedValue(mockRes);

      const result = await fetchTokenInfo('0x1234567890abcdef1234567890abcdef12345678');
      expect(result).toBe(null);
    });
  });
});
