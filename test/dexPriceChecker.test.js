// ==============================
// Tests for checkers/dexPriceChecker.js
// ==============================

const { initCollections, fetchBatchPrices, formatPrice } = require('../checkers/dexPriceChecker');

describe('dexPriceChecker.js', () => {
  let mockAlertsCollection;
  let mockUsersCollection;

  beforeEach(() => {
    mockAlertsCollection = {
      find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    mockUsersCollection = {
      find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    };
    initCollections(mockAlertsCollection, mockUsersCollection);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('formatPrice', () => {
    test('formats small price with exponential notation', () => {
      expect(formatPrice(0.00001)).toBe('1.000e-5');
    });

    test('formats price less than 1', () => {
      expect(formatPrice(0.5)).toBe('0.5000');
    });

    test('formats price greater than 1', () => {
      expect(formatPrice(123.456)).toBe('123.4560');
    });
  });

  describe('fetchBatchPrices', () => {
    test('returns map of prices for valid response', async () => {
      const mockRes = {
        ok: true,
        status: 200,
        json: async () => [
          {
            baseToken: { address: '0xabc', symbol: 'ETH' },
            priceUsd: '1500.50',
            url: 'https://dex.example.com',
            liquidity: { usd: 1000000 },
          },
        ],
      };
      global.fetch = jest.fn().mockResolvedValue(mockRes);

      const result = await fetchBatchPrices('ethereum', ['0xabc']);
      expect(result['0xabc']).toEqual({
        price: 1500.5,
        url: 'https://dex.example.com',
        symbol: 'ETH',
        liquidity: 1000000,
      });
    });

    test('returns empty object on HTTP error', async () => {
      const mockRes = {
        ok: false,
        status: 500,
      };
      global.fetch = jest.fn().mockResolvedValue(mockRes);

      const result = await fetchBatchPrices('ethereum', ['0xabc']);
      expect(result).toEqual({});
    });
  });
});
