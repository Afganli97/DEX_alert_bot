const { formatPrice } = require('../checkers/dexPriceChecker');

describe('dexPriceChecker.formatPrice()', () => {
  test('formats very small price with exponential', () => {
    expect(formatPrice(0.0000123)).toMatch(/e/);
  });
  test('formats price < 1 with precision', () => {
    expect(formatPrice(0.123456)).toBe('0.1235');
  });
  test('formats price >= 1 with fixed decimals', () => {
    expect(formatPrice(12.34567)).toBe('12.3457');
  });
});
