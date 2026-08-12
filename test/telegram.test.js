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

  test('escapes double quote', () => {
    expect(escapeHtml('a "b" c')).toBe('a &quot;b&quot; c');
  });

  test('escapes single quote', () => {
    expect(escapeHtml("a 'b' c")).toBe("a &#x27;b&#x27; c");
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
