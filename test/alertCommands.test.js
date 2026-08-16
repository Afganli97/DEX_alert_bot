// ==============================
// Tests for handlers/alertCommands.js
// ==============================

const {
  initCollections,
  getUserAlerts,
  addAlert,
  removeAlert,
  updateAlertThreshold,
  resetBaselines,
  updateAllThresholds,
  isValidTokenAddress,
} = require('../handlers/alertCommands');

describe('alertCommands.js', () => {
  let mockAlertsCollection;
  let mockUsersCollection;

  beforeEach(() => {
    mockAlertsCollection = {
      find: jest.fn(),
      insertOne: jest.fn().mockResolvedValue({ insertedId: '123' }),
      deleteOne: jest.fn().mockResolvedValue({}),
      updateOne: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({}),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
    mockUsersCollection = {
      findOne: jest.fn().mockResolvedValue({ subscription: 'basic' }),
    };
    initCollections(mockAlertsCollection, mockUsersCollection);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('isValidTokenAddress', () => {
    test('validates EVM addresses', () => {
      expect(isValidTokenAddress('0x1234567890123456789012345678901234567890')).toBe(true);
      expect(isValidTokenAddress('0xABCDEF1234567890ABCDEF1234567890ABCDEF12')).toBe(true);
    });

    test('validates Solana addresses', () => {
      expect(isValidTokenAddress('11111111111111111111111111111111')).toBe(true);
      expect(isValidTokenAddress('So11111111111111111111111111111111111111112')).toBe(true);
    });

    test('rejects invalid addresses', () => {
      expect(isValidTokenAddress('invalid')).toBe(false);
      expect(isValidTokenAddress('0xinvalid')).toBe(false);
      expect(isValidTokenAddress('')).toBe(false);
    });
  });

  describe('getUserAlerts', () => {
    test('returns user alerts', async () => {
      const mockAlerts = [{ _id: '1', ownerId: '123', target: { chain: 'ethereum', address: '0xabc' } }];
      mockAlertsCollection.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue(mockAlerts) });

      const result = await getUserAlerts('123');
      expect(result).toEqual(mockAlerts);
      expect(mockAlertsCollection.find).toHaveBeenCalledWith({ ownerId: '123', source: 'dex' });
    });
  });

  describe('addAlert', () => {
    test('adds alert successfully', async () => {
      await addAlert('123', 'ethereum', '0x1234567890123456789012345678901234567890', 'TestToken', 10);
      expect(mockAlertsCollection.insertOne).toHaveBeenCalledWith(expect.objectContaining({
        ownerId: '123',
        source: 'dex',
        target: { chain: 'ethereum', address: '0x1234567890123456789012345678901234567890' },
        condition: { kind: 'percent_change', changePercent: 10, baselinePrice: null },
        status: 'active',
      }));
    });

    test('throws on invalid ownerId', async () => {
      await expect(addAlert('', 'ethereum', '0x1234567890123456789012345678901234567890', 'Test', 10))
        .rejects.toThrow('Invalid ownerId');
    });

    test('throws on invalid address', async () => {
      await expect(addAlert('123', 'ethereum', 'invalid', 'Test', 10))
        .rejects.toThrow('Invalid token address');
    });

    test('throws on invalid changePercent', async () => {
      await expect(addAlert('123', 'ethereum', '0x1234567890123456789012345678901234567890', 'Test', -10))
        .rejects.toThrow('Invalid changePercent value');
    });

    test('throws when token limit reached', async () => {
      mockAlertsCollection.countDocuments.mockResolvedValueOnce(5);
      await expect(addAlert('123', 'ethereum', '0x1234567890123456789012345678901234567890', 'Test', 10))
        .rejects.toThrow('TOKEN_LIMIT_REACHED:5');
    });
  });

  describe('removeAlert', () => {
    test('removes alert', async () => {
      await removeAlert('alertId123', '123');
      expect(mockAlertsCollection.deleteOne).toHaveBeenCalledWith({ _id: 'alertId123', ownerId: '123' });
    });
  });

  describe('updateAlertThreshold', () => {
    test('updates threshold', async () => {
      await updateAlertThreshold('alertId123', '123', 15);
      expect(mockAlertsCollection.updateOne).toHaveBeenCalledWith(
        { _id: 'alertId123', ownerId: '123' },
        { $set: { 'condition.changePercent': 15 } }
      );
    });

    test('throws on invalid ownerId', async () => {
      await expect(updateAlertThreshold('alertId123', '', 15))
        .rejects.toThrow('Invalid ownerId');
    });

    test('throws on invalid percent', async () => {
      await expect(updateAlertThreshold('alertId123', '123', -5))
        .rejects.toThrow('Invalid newPercent value');
    });
  });

  describe('resetBaselines', () => {
    test('resets baselines', async () => {
      await resetBaselines('123');
      expect(mockAlertsCollection.updateMany).toHaveBeenCalledWith(
        { ownerId: '123' },
        { $set: { 'condition.baselinePrice': null } }
      );
    });
  });

  describe('updateAllThresholds', () => {
    test('updates all thresholds', async () => {
      await updateAllThresholds('123', 20);
      expect(mockAlertsCollection.updateMany).toHaveBeenCalledWith(
        { ownerId: '123' },
        { $set: { 'condition.changePercent': 20 } }
      );
    });
  });
});
