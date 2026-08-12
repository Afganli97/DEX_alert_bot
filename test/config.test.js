const { num } = require('../config');

describe('config.num()', () => {
  const ORIGINAL_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });
  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('returns fallback when env var missing', () => {
    delete process.env.TEST_VAR;
    expect(num('TEST_VAR', 5)).toBe(5);
  });

  test('parses valid integer', () => {
    process.env.TEST_VAR = '42';
    expect(num('TEST_VAR', 5)).toBe(42);
  });

  test('returns fallback for non-integer', () => {
    process.env.TEST_VAR = 'abc';
    expect(num('TEST_VAR', 7)).toBe(7);
  });

  test('enforces min value', () => {
    process.env.TEST_VAR = '-3';
    expect(num('TEST_VAR', 10, 0)).toBe(10);
  });
});
