// ==============================
// Tests for lib/telegram.js - escapeHtml
// ==============================

const { escapeHtml } = require('../lib/telegram');

describe('escapeHtml', () => {
  test('escapes ampersand', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  test('escapes less-than', () => {
    expect(escapeHtml('a < b')).toBe('a &lt; b');
  });

  test('escapes greater-than', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b');
  });

  test('does not escape double quote (not in implementation)', () => {
    expect(escapeHtml('a "b" c')).toBe('a "b" c');
  });

  test('does not escape single quote (not in implementation)', () => {
    expect(escapeHtml("a 'b' c")).toBe("a 'b' c");
  });

  test('leaves backslash as single character', () => {
    expect(escapeHtml('a\\b')).toBe('a\\b');
  });

  test('returns empty string for empty input', () => {
    expect(escapeHtml('')).toBe('');
  });

  test('converts non-string to string', () => {
    expect(escapeHtml(123)).toBe('123');
    expect(escapeHtml(null)).toBe('null');
    expect(escapeHtml(undefined)).toBe('undefined');
  });
});
