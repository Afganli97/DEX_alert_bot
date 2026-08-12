// ==============================
// Tests for lib/telegramQueue.js
// ==============================

const { TelegramQueue } = require('../lib/telegramQueue');

describe('TelegramQueue', () => {
  let mockUsersCollection;
  let mockFetch;
  let originalFetch;

  beforeEach(() => {
    mockUsersCollection = {
      updateOne: jest.fn().mockResolvedValue({}),
    };
    originalFetch = global.fetch;
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  test('constructor initializes queue', () => {
    const queue = new TelegramQueue(mockUsersCollection);
    expect(queue.queue).toEqual([]);
    expect(queue.processing).toBe(false);
    expect(queue.usersCollection).toBe(mockUsersCollection);
  });

  test('push adds message to queue and starts processing', async () => {
    const queue = new TelegramQueue(mockUsersCollection);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });
    
    const promise = queue.push('123', 'Hello');
    
    // Queue is processed immediately, so it should be empty after push
    expect(queue.queue).toHaveLength(0);
    expect(promise).toBeInstanceOf(Promise);
    
    // Wait for async processing
    await new Promise(resolve => setTimeout(resolve, 50));
    const resolved = await promise;
    expect(resolved).toBe(true);
  });

  test('returns true on successful send', async () => {
    const queue = new TelegramQueue(mockUsersCollection);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const result = queue.push('123', 'Test message');
    // Wait for async processing
    await new Promise(resolve => setTimeout(resolve, 100));
    const resolved = await result;
    expect(resolved).toBe(true);
  });

  test('marks user as blocked on 403 error', async () => {
    const queue = new TelegramQueue(mockUsersCollection);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ ok: false, error_code: 403 }),
    });

    const result = queue.push('123', 'Test');
    await new Promise(resolve => setTimeout(resolve, 100));
    const resolved = await result;
    expect(resolved).toBe(false);
    expect(mockUsersCollection.updateOne).toHaveBeenCalledWith(
      { _id: '123' },
      { $set: { status: 'blocked' } }
    );
  });

  test('handles network errors gracefully', async () => {
    const queue = new TelegramQueue(mockUsersCollection);
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = queue.push('123', 'Test');
    await new Promise(resolve => setTimeout(resolve, 100));
    const resolved = await result;
    expect(resolved).toBe(false);
  });
});
