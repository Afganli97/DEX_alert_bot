// ==============================
// User management functions
// ==============================

const config = require('../config');

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
 * Get subscription limit for a user
 * @param {string} subscription - Subscription level ('basic', 'pro', 'premium')
 * @returns {number} Maximum number of tokens allowed
 */
function getSubscriptionLimit(subscription) {
  const validSubscriptions = ['basic', 'pro', 'premium'];
  if (!validSubscriptions.includes(subscription)) {
    return config.subscriptionLimits.basic;
  }
  return config.subscriptionLimits[subscription] ?? config.subscriptionLimits.basic;
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
        createdAt: new Date(),
        status: 'active',
        subscription: 'basic',
      },
      $set: {
        lastActivityAt: new Date(),
        username: username || null,
      },
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

module.exports = {
  initUsers,
  getUsersCollection,
  ensureUser,
  isAdmin,
  getSubscriptionLimit,
};