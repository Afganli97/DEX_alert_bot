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

describe('config.subscriptionLimits', () => {
  test('has default subscription limits', () => {
    const config = require('../config');
    expect(config.subscriptionLimits.basic).toBe(5);
    expect(config.subscriptionLimits.pro).toBe(15);
    expect(config.subscriptionLimits.premium).toBe(50);
  });

  test('allows overriding subscription limits via env', () => {
    process.env.SUBSCRIPTION_LIMIT_BASIC = '10';
    process.env.SUBSCRIPTION_LIMIT_PRO = '30';
    process.env.SUBSCRIPTION_LIMIT_PREMIUM = '100';

    jest.resetModules();
    const updatedConfig = require('../config');

    expect(updatedConfig.subscriptionLimits.basic).toBe(10);
    expect(updatedConfig.subscriptionLimits.pro).toBe(30);
    expect(updatedConfig.subscriptionLimits.premium).toBe(100);
  });

  test('falls back to defaults for invalid env values', () => {
    process.env.SUBSCRIPTION_LIMIT_BASIC = 'invalid';
    process.env.SUBSCRIPTION_LIMIT_PRO = '-5';

    jest.resetModules();
    const updatedConfig = require('../config');

    expect(updatedConfig.subscriptionLimits.basic).toBe(5);
    expect(updatedConfig.subscriptionLimits.pro).toBe(15);
  });
});
