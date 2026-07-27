// ==============================
// Database connection
// ==============================

const { MongoClient } = require('mongodb');

let client;
let db;

/**
 * Connect to MongoDB
 * @param {string} uri - MongoDB connection URI
 * @returns {Object} Object with db and client
 */
async function connectToMongo(uri) {
  client = new MongoClient(uri);
  await client.connect();
  db = client.db();
  console.log('✅ Подключено к MongoDB');
  return { db, client };
}

/**
 * Close MongoDB connection
 */
async function closeMongo() {
  if (client) {
    await client.close();
    console.log('🔌 Соединение с MongoDB закрыто');
  }
}

/**
 * Get database instance
 * @returns {Object} Database instance
 */
function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call connectToMongo first.');
  }
  return db;
}

module.exports = {
  connectToMongo,
  closeMongo,
  getDb,
};