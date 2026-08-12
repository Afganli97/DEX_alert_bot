// ==============================
// Tests for handlers/commands.js
// ==============================

const { initCollections } = require('../handlers/commands');

describe('commands.js', () => {
  let mockAlertsCollection;
  let mockUsersCollection;

  beforeEach(() => {
    mockAlertsCollection = {
      deleteMany: jest.fn().mockResolvedValue({}),
      deleteOne: jest.fn().mockResolvedValue({}),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
    mockUsersCollection = {
      deleteOne: jest.fn().mockResolvedValue({}),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initCollections', () => {
    test('initializes collections', () => {
      initCollections(mockAlertsCollection, mockUsersCollection);
      expect(() => initCollections(mockAlertsCollection, mockUsersCollection)).not.toThrow();
    });
  });

  describe('module exports', () => {
    test('exports initCollections', () => {
      expect(typeof initCollections).toBe('function');
    });

    test('exports handleMessage', () => {
      const { handleMessage } = require('../handlers/commands');
      expect(typeof handleMessage).toBe('function');
    });
  });
});
