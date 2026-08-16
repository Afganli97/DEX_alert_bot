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
  test('accepts valid Solana token address (WSOL)', () => {
    expect(isValidTokenAddress('So11111111111111111111111111111111111111112')).toBe(true);
  });
  test('rejects base58 string with correct length but invalid characters', () => {
    // Contains '0' which is not in base58 alphabet
    expect(isValidTokenAddress('11111111111111111111111111111111111111111111')).toBe(false);
  });
  test('rejects EVM address passed as Solana', () => {
    expect(isValidTokenAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe(true);
  });
});
