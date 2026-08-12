// ==============================
// Tests for lib/fetchWithRetry.js
// ==============================

const { fetchWithRetry } = require('../lib/fetchWithRetry');

describe('fetchWithRetry', () => {
  let mockFetch;
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('returns response on first attempt', async () => {
    const mockResponse = { ok: true, status: 200, json: async () => ({ data: 'test' }) };
    mockFetch.mockResolvedValueOnce(mockResponse);

    const result = await fetchWithRetry('https://example.com');
    expect(result).toBe(mockResponse);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('retries on network error', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: 'test' }) });

    const result = await fetchWithRetry('https://example.com', {}, 2, 10);
    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('returns falsy response after max retries exhausted', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const result = await fetchWithRetry('https://example.com', {}, 2, 10);
    expect(result.ok).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('respects custom timeout', async () => {
    const controller = { signal: {} };
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    mockFetch.mockImplementation(() => {
      throw new DOMException('Aborted', 'AbortError');
    });

    await fetchWithRetry('https://example.com', {}, 1, 10, 5000);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
    setTimeoutSpy.mockRestore();
  });
});
