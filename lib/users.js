// ==============================
// User management functions
// ==============================

let usersCollection = null;

/**
 * Initialize users collection
 * @param {Object} collection - MongoDB collection
 */
function initUsers(collection) {
  usersCollection = collection;
}

/**
 * Get users collection
 */
function getUsersCollection() {
  return usersCollection;
}

/**
 * Ensure user exists in database, create if not
 * @param {string} chatId - User's Telegram chat ID
 * @param {string|null} username - User's Telegram username
 * @returns {Promise<Object>} User document
 */
async function ensureUser(chatId, username) {
  // Валидация chatId (должно быть положительным числом/строкой)
  if (!chatId || typeof chatId !== 'string' || chatId.trim() === '') {
    throw new Error('Invalid chatId');
  }

  // Очистка chatId от пробелов
  chatId = chatId.trim();

  // Валидация username (если предоставлен)
  if (username && (typeof username !== 'string' || username.length > 100)) {
    username = null;
  }

  const doc = await usersCollection.findOneAndUpdate(
    { _id: chatId },
    {
      $setOnInsert: {
        _id: chatId,
        username: username || null,
        createdAt: new Date(),
        status: 'active',
        maxTokens: 20,
        lastActivityAt: new Date(),
      },
      $set: { lastActivityAt: new Date(), username: username || null },
    },
    { upsert: true, returnDocument: 'after' }
  );
  return doc.value;
}

/**
 * Check if user is admin
 * @param {string} chatId - User's Telegram chat ID
 * @returns {boolean} True if user is admin
 */
function isAdmin(chatId) {
  const ADMIN_IDS = (process.env.ADMIN_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  return ADMIN_IDS.includes(chatId);
}

/**
 * Mark user as blocked (when bot is blocked by user)
 * @param {string} chatId - User's Telegram chat ID
 */
async function markUserBlocked(chatId) {
  await usersCollection.updateOne({ _id: chatId }, { $set: { status: 'blocked' } });
}

/**
 * Get user by ID
 * @param {string} chatId - User's Telegram chat ID
 * @returns {Promise<Object|null>} User document
 */
async function getUser(chatId) {
  return await usersCollection.findOne({ _id: chatId });
}

module.exports = {
  initUsers,
  getUsersCollection,
  ensureUser,
  isAdmin,
  markUserBlocked,
  getUser,
};