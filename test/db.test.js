// ==============================
// Tests for lib/db.js
// ==============================

describe('db.js', () => {
  let mockMongoClient;
  let mockDb;
  let mockAlertsCollection;

  beforeEach(() => {
    mockAlertsCollection = {
      createIndex: jest.fn().mockResolvedValue('index_name_1'),
    };
    mockDb = {
      collection: jest.fn().mockReturnValue(mockAlertsCollection),
    };
    mockMongoClient = {
      connect: jest.fn().mockResolvedValue(undefined),
      db: jest.fn().mockReturnValue(mockDb),
      close: jest.fn().mockResolvedValue(undefined),
    };
    jest.mock('mongodb', () => ({
      MongoClient: jest.fn().mockImplementation(() => mockMongoClient),
    }));
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  test('connects to MongoDB and creates indexes', async () => {
    const { connectToMongo } = require('../lib/db');
    await connectToMongo('mongodb://localhost:27017/test');

    expect(mockMongoClient.connect).toHaveBeenCalled();
    expect(mockMongoClient.db).toHaveBeenCalledWith('admin');
    expect(mockDb.collection).toHaveBeenCalledWith('alerts');
    expect(mockAlertsCollection.createIndex).toHaveBeenCalledTimes(2);
  });

  test('throws error when URI is missing', async () => {
    const { connectToMongo } = require('../lib/db');
    await expect(connectToMongo(null)).rejects.toThrow('MongoDB URI is required');
  });

  test('throws error for invalid URI format', async () => {
    const { connectToMongo } = require('../lib/db');
    await expect(connectToMongo('invalid-uri')).rejects.toThrow('Invalid MongoDB URI format');
  });
});
