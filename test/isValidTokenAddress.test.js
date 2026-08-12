const { isValidTokenAddress } = require('../handlers/alertCommands');

describe('alertCommands.isValidTokenAddress()', () => {
  test('accepts valid EVM address', () => {
    expect(isValidTokenAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe(true);
  });
  test('rejects malformed address', () => {
    expect(isValidTokenAddress('invalid')).toBe(false);
  });
  test('accepts valid Solana address', () => {
    expect(isValidTokenAddress('5D7V7Yz9KQeVZcVtX9cV9fZcV9cV9cV9cV9cV9cV9cV')).toBe(true);
  });
});
