// ==============================
// Mock MongoDB collection for tests
// ==============================

function createMockCollection() {
  const operations = {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    insertOne: jest.fn(),
    insertMany: jest.fn(),
    updateOne: jest.fn(),
    updateMany: jest.fn(),
    deleteOne: jest.fn(),
    deleteMany: jest.fn(),
    countDocuments: jest.fn(),
    createIndex: jest.fn(),
  };

  return operations;
}

module.exports = { createMockCollection };
