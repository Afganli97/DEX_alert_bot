const { MongoClient } = require('mongodb');

let client;
let db;

async function connectToMongo(uri) {
  if (!uri) {
    throw new Error('MongoDB URI is required. Set MONGO_URI environment variable.');
  }
  if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
    throw new Error('Invalid MongoDB URI format. Must start with mongodb:// or mongodb+srv://');
  }

  client = new MongoClient(uri, {
    maxPoolSize: 10,
    minPoolSize: 1,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 10000,
  });

  try {
    await client.connect();
    await client.db('admin').command({ ping: 1 });
    db = client.db();
    // Ensure indexes for alerts collection
    await db.collection('alerts').createIndex({ source: 1, status: 1 }, { unique: false });
    await db.collection('alerts').createIndex({ ownerId: 1 }, { unique: false });
    // Unique index to prevent duplicate alerts for same user/chain/address
    await db.collection('alerts').createIndex(
      { ownerId: 1, 'target.chain': 1, 'target.address': 1 },
      { unique: true }
    );
    console.log('✅ Подключено к MongoDB');
    return { db, client };
  } catch (err) {
    await client.close().catch(() => {});
    console.error('MongoDB connection error:', err.message);
    throw err;
  }
}

async function closeMongo() {
  if (client) {
    try {
      await client.close();
      console.log('🔌 Соединение с MongoDB закрыто');
    } catch (err) {
      console.error('Error closing MongoDB connection:', err);
    }
    client = null;
    db = null;
  }
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call connectToMongo first.');
  return db;
}

module.exports = { connectToMongo, closeMongo, getDb };
