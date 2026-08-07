// ==============================
// Admin Commands
// ==============================

let alertsCollection = null;
let usersCollection = null;

/**
 * Initialize collections
 * @param {Object} alerts - Alerts collection
 * @param {Object} users - Users collection
 */
function initCollections(alerts, users) {
  alertsCollection = alerts;
  usersCollection = users;
}

// ============ Admin Panel ============

/**
 * Handle admin commands
 * @param {string} chatId - User's chat ID
 * @param {string} text - Command text
 * @param {Function} sendTelegram - Function to send telegram message
 * @param {Function} isAdmin - Function to check admin status
 * @returns {Promise<boolean>} True if command was handled, false otherwise
 */
async function handleAdminCommand(chatId, text, sendTelegram, isAdmin) {
  if (!isAdmin(chatId)) {
    await sendTelegram(chatId, '❌ Недоступно.');
    return true;
  }

  const parts = text.trim().split(/\s+/);
  const sub = parts[1];
  switch (sub) {
    case 'stats': {
      const totalUsers = await usersCollection.countDocuments({});
      const totalAlerts = await alertsCollection.countDocuments({});
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const activeLastHour = await usersCollection.countDocuments({ lastActivityAt: { $gte: oneHourAgo }, status: 'active' });
      await sendTelegram(chatId, '<b>📊 Статистика:</b>\n' +
        `Пользователей всего: ${totalUsers}\n` +
        `Активных алертов: ${totalAlerts}\n` +
        `Активных за последний час: ${activeLastHour}`);
      return true;
    }
    case 'block_user': {
      const targetId = parts[2];
      if (!targetId) {
        await sendTelegram(chatId, 'Usage: /admin block_user <chatId>');
        return true;
      }
      await usersCollection.updateOne({ _id: targetId }, { $set: { status: 'blocked' } });
      await sendTelegram(chatId, `✅ Пользователь ${targetId} заблокирован.`);
      return true;
    }
    case 'unblock_user': {
      const targetId = parts[2];
      if (!targetId) {
        await sendTelegram(chatId, 'Usage: /admin unblock_user <chatId>');
        return true;
      }
      await usersCollection.updateOne({ _id: targetId }, { $set: { status: 'active' } });
      await sendTelegram(chatId, `✅ Пользователь ${targetId} разблокирован.`);
      return true;
    }
    case 'reset_all_anchors': {
      await alertsCollection.updateMany({}, { $set: { 'condition.baselinePrice': null } });
      await sendTelegram(chatId, '✅ Якорные цены всех токенов сброшены.');
      return true;
    }
    case 'view_user': {
      const targetId = parts[2];
      if (!targetId) {
        await sendTelegram(chatId, 'Usage: /admin view_user <chatId>');
        return true;
      }
      const user = await usersCollection.findOne({ _id: targetId });
      if (!user) {
        await sendTelegram(chatId, 'Пользователь не найден.');
        return true;
      }
      const alertCount = await alertsCollection.countDocuments({ ownerId: targetId });
      const status = user.status ?? 'unknown';
      await sendTelegram(chatId, `<b>👤 Инфо о пользователе ${targetId}:</b>\n` +
        `Статус: ${status}\n` +
        `Количество алертов: ${alertCount}`);
      return true;
    }
    default:
      await sendTelegram(chatId, 'Неизвестная подкоманда. Доступные: stats, block_user, unblock_user, reset_all_anchors, view_user');
      return true;
  }
}

module.exports = {
  initCollections,
  handleAdminCommand
};