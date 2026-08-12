// ==============================
// Tests for lib/users.js
// ==============================

const { ensureUser, isAdmin, markUserBlocked, getUser, initUsers, getUsersCollection } = require('../lib/users');

describe('users.js', () => {
  let mockCollection;
  let originalEnv;

  beforeEach(() => {
    mockCollection = {
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({}),
      findOne: jest.fn(),
      countDocuments: jest.fn(),
    };
    initUsers(mockCollection);
    originalEnv = process.env.ADMIN_CHAT_IDS;
  });

  afterEach(() => {
    process.env.ADMIN_CHAT_IDS = originalEnv;
    jest.clearAllMocks();
  });

  describe('ensureUser', () => {
    test('creates new user with defaults', async () => {
      mockCollection.findOneAndUpdate.mockResolvedValueOnce({
        value: {
          _id: '123',
          username: 'testuser',
          createdAt: expect.any(Date),
          status: 'active',
          maxTokens: 20,
          lastActivityAt: expect.any(Date),
        },
      });

      const result = await ensureUser('123', 'testuser');
      expect(result._id).toBe('123');
      expect(result.status).toBe('active');
      expect(result.maxTokens).toBe(20);
    });

    test('throws on invalid chatId', async () => {
      await expect(ensureUser('', 'user')).rejects.toThrow('Invalid chatId');
      await expect(ensureUser(null, 'user')).rejects.toThrow('Invalid chatId');
    });

    test('trims chatId', async () => {
      mockCollection.findOneAndUpdate.mockResolvedValueOnce({
        value: { _id: '123', status: 'active' },
      });
      await ensureUser(' 123 ', 'user');
      expect(mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: '123' },
        expect.any(Object),
        expect.any(Object)
      );
    });

    test('sets username to null if invalid', async () => {
      mockCollection.findOneAndUpdate.mockResolvedValueOnce({
        value: { _id: '123', username: null },
      });
      await ensureUser('123', 'a'.repeat(101));
      expect(mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: '123' },
        expect.objectContaining({
          $setOnInsert: expect.objectContaining({ username: null }),
        }),
        expect.any(Object)
      );
    });
  });

  describe('isAdmin', () => {
    test('returns true for admin chatId', () => {
      process.env.ADMIN_CHAT_IDS = '123,456';
      expect(isAdmin('123')).toBe(true);
      expect(isAdmin('456')).toBe(true);
    });

    test('returns false for non-admin chatId', () => {
      process.env.ADMIN_CHAT_IDS = '123,456';
      expect(isAdmin('789')).toBe(false);
    });

    test('handles empty ADMIN_CHAT_IDS', () => {
      process.env.ADMIN_CHAT_IDS = '';
      expect(isAdmin('123')).toBe(false);
    });
  });

  describe('markUserBlocked', () => {
    test('updates user status to blocked', async () => {
      await markUserBlocked('123');
      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { _id: '123' },
        { $set: { status: 'blocked' } }
      );
    });
  });

  describe('getUser', () => {
    test('returns user document', async () => {
      const mockUser = { _id: '123', username: 'test', status: 'active' };
      mockCollection.findOne.mockResolvedValueOnce(mockUser);

      const result = await getUser('123');
      expect(result).toEqual(mockUser);
    });

    test('returns null if user not found', async () => {
      mockCollection.findOne.mockResolvedValueOnce(null);
      const result = await getUser('999');
      expect(result).toBeNull();
    });
  });

  describe('initUsers / getUsersCollection', () => {
    test('stores and retrieves collection', () => {
      const newCollection = { test: true };
      initUsers(newCollection);
      expect(getUsersCollection()).toBe(newCollection);
    });
  });
});
