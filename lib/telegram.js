// ==============================
// Telegram utilities: escaping, queue, and sending
// ==============================

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const { TelegramQueue } = require('./telegramQueue');

let telegramQueue = null;

/**
 * Initialize the Telegram queue with the users collection.
 * Must be called before using sendTelegram.
 * @param {Object} usersCollection - MongoDB users collection
 */
function setUsersCollection(usersCollection) {
  telegramQueue = new TelegramQueue(usersCollection);
}

/**
 * Send a telegram message via the queue.
 * @param {string|number} chatId - Telegram chat ID
 * @param {string} text - Message text
 * @returns {Promise<boolean>} True if message was sent successfully
 */
async function sendTelegram(chatId, text) {
  if (!telegramQueue) {
    throw new Error('TelegramQueue not initialized. Call setUsersCollection first.');
  }
  return telegramQueue.push(chatId, text);
}

module.exports = { escapeHtml, sleep, setUsersCollection, sendTelegram };
