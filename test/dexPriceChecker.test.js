// ==============================
// Tests for checkers/dexPriceChecker.js - getDexAlerts, getBlockedUsers, updateAlertBaseline, runCycle
// ==============================

describe('dexPriceChecker.js - additional functions', () => {
  let mockAlertsCollection;
  let mockUsersCollection;
  let dexPriceChecker;

  beforeEach(() => {
    mockAlertsCollection = {
      find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    mockUsersCollection = {
      find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    };
    
    // Reset modules to get fresh instance
    jest.resetModules();
    dexPriceChecker = require('../checkers/dexPriceChecker');
    dexPriceChecker.initCollections(mockAlertsCollection, mockUsersCollection);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getDexAlerts', () => {
    test('returns active dex alerts', async () => {
      const mockAlerts = [
        { _id: 'a1', source: 'dex', status: 'active', ownerId: '123', target: { chain: 'ethereum', address: '0x123' } },
        { _id: 'a2', source: 'dex', status: 'active', ownerId: '456', target: { chain: 'solana', address: '111111' } },
      ];
      mockAlertsCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue(mockAlerts),
      });

      const result = await dexPriceChecker.getDexAlerts();
      expect(result).toEqual(mockAlerts);
      expect(mockAlertsCollection.find).toHaveBeenCalledWith({ source: 'dex', status: 'active' });
    });
  });

  describe('getBlockedUsers', () => {
    test('returns cached blocked users when not expired', async () => {
      const mockBlockedUsers = [{ _id: '111' }, { _id: '222' }];
      mockUsersCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue(mockBlockedUsers),
        forEach: jest.fn().mockImplementation(async (cb) => {
          for (const user of mockBlockedUsers) await cb(user);
        }),
      });

      const result = await dexPriceChecker.getBlockedUsers();
      expect(result.has('111')).toBe(true);
      expect(result.has('222')).toBe(true);
      expect(result.has('999')).toBe(false);
    });

    test('returns empty set when no blocked users', async () => {
      mockUsersCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
        forEach: jest.fn().mockImplementation(async (cb) => {}),
      });

      const result = await dexPriceChecker.getBlockedUsers();
      expect(result.size).toBe(0);
    });
  });

  describe('updateAlertBaseline', () => {
    test('updates alert baseline price', async () => {
      const mockId = { toString: () => 'alert123' };
      await dexPriceChecker.updateAlertBaseline(mockId, 1500.50);

      expect(mockAlertsCollection.updateOne).toHaveBeenCalledWith(
        { _id: mockId },
        { $set: { 'condition.baselinePrice': 1500.50 } }
      );
    });
  });

  describe('runCycle', () => {
    test('returns early when no alerts', async () => {
      const ctx = { shuttingDown: false, isChecking: false };
      await dexPriceChecker.runCycle(ctx);
      expect(ctx.isChecking).toBe(false);
    });

    test('returns early when shutting down', async () => {
      const ctx = { shuttingDown: true, isChecking: false };
      await dexPriceChecker.runCycle(ctx);
      expect(mockAlertsCollection.find).not.toHaveBeenCalled();
    });

    test('returns early when already checking', async () => {
      const ctx = { shuttingDown: false, isChecking: true };
      await dexPriceChecker.runCycle(ctx);
      expect(mockAlertsCollection.find).not.toHaveBeenCalled();
    });

    test('skips blocked users', async () => {
      const mockAlerts = [
        { _id: 'a1', source: 'dex', status: 'active', ownerId: 'blocked123', target: { chain: 'ethereum', address: '0x123' } },
      ];
      mockAlertsCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue(mockAlerts),
      });

      // Mock blocked users
      mockUsersCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([{ _id: 'blocked123' }]),
        forEach: jest.fn().mockImplementation(async (cb) => {
          await cb({ _id: 'blocked123' });
        }),
      });

      const ctx = { shuttingDown: false, isChecking: false };
      await dexPriceChecker.runCycle(ctx);
      expect(ctx.isChecking).toBe(false);
    });
  });
});
