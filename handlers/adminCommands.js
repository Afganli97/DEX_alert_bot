// ==============================
// Admin Commands
// ==============================

const { getSubscriptionLimit } = require('../lib/users');

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
      if (!targetId || !/^\d+$/.test(targetId)) {
        await sendTelegram(chatId, 'Usage: /admin block_user <chatId>');
        return true;
      }
      const user = await usersCollection.findOne({ _id: targetId });
      if (!user) {
        await sendTelegram(chatId, `❌ Пользователь ${targetId} не найден.`);
        return true;
      }
      await usersCollection.updateOne({ _id: targetId }, { $set: { status: 'blocked' } });
      await sendTelegram(chatId, `✅ Пользователь ${targetId} заблокирован.`);
      return true;
    }
    case 'unblock_user': {
      const targetId = parts[2];
      if (!targetId || !/^\d+$/.test(targetId)) {
        await sendTelegram(chatId, 'Usage: /admin unblock_user <chatId>');
        return true;
      }
      const user = await usersCollection.findOne({ _id: targetId });
      if (!user) {
        await sendTelegram(chatId, `❌ Пользователь ${targetId} не найден.`);
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
      const subscription = user.subscription ?? 'basic';
      const subscriptionLimit = getSubscriptionLimit(subscription);
      await sendTelegram(chatId, `<b>👤 Инфо о пользователе ${targetId}:</b>\n` +
        `Статус: ${status}\n` +
        `Подписка: ${subscription} (лимит: ${subscriptionLimit} токенов)\n` +
        `Количество алертов: ${alertCount}`);
      return true;
    }
    case 'set_subscription': {
      const targetId = parts[2];
      const newSubscription = parts[3];
      if (!targetId || !/^\d+$/.test(targetId)) {
        await sendTelegram(chatId, 'Usage: /admin set_subscription <chatId> <basic|pro|premium>');
        return true;
      }
      const validSubscriptions = ['basic', 'pro', 'premium'];
      if (!validSubscriptions.includes(newSubscription)) {
        await sendTelegram(chatId, '❌ Неверный тип подписки. Доступные: basic, pro, premium');
        return true;
      }
      const user = await usersCollection.findOne({ _id: targetId });
      if (!user) {
        await sendTelegram(chatId, `❌ Пользователь ${targetId} не найден.`);
        return true;
      }
      await usersCollection.updateOne({ _id: targetId }, { $set: { subscription: newSubscription } });
      const limit = getSubscriptionLimit(newSubscription);
      await sendTelegram(chatId, `✅ Подписка пользователя ${targetId} изменена на ${newSubscription} (лимит: ${limit} токенов).`);
      return true;
    }
    default:
      await sendTelegram(chatId, 'Неизвестная подкоманда. Доступные: stats, block_user, unblock_user, reset_all_anchors, view_user, set_subscription');
      return true;
  }
}

module.exports = {
  initCollections,
  handleAdminCommand
};