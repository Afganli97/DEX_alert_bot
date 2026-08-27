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

describe('setUsersCollection and sendTelegram', () => {
  let mockUsersCollection;

  beforeEach(() => {
    mockUsersCollection = {
      updateOne: jest.fn().mockResolvedValue({}),
    };
    // Stub global fetch so TelegramQueue.sendTelegramTo does not hit the network
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    delete global.fetch;
  });

  test('sendTelegram throws when queue not initialized', async () => {
    jest.resetModules();
    const { sendTelegram } = require('../lib/telegram');
    await expect(sendTelegram('123', 'test')).rejects.toThrow(
      'TelegramQueue not initialized. Call setUsersCollection first.'
    );
  });

  test('setUsersCollection initializes the queue so sendTelegram can send', async () => {
    jest.resetModules();
    const { setUsersCollection, sendTelegram } = require('../lib/telegram');
    setUsersCollection(mockUsersCollection);
    // After init, sendTelegram should not throw the "not initialized" error
    // and should delegate to TelegramQueue.push via fetch
    const result = await sendTelegram('123', 'Hello');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });
});
