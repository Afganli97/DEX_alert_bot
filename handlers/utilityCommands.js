// ==============================
// Utility Commands
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

// ============ Utility Commands ============

/**
 * Handle start/help commands
 * @param {string} chatId - User's chat ID
 * @param {Function} sendTelegram - Function to send telegram message
 * @param {Function} isAdmin - Function to check admin status
 * @param {Object} session - User session object
 */
function handleStartHelp(chatId, sendTelegram, isAdmin, session) {
  session.state = null;
  session.pendingData = {};
  let helpText = '<b>📖 Команды бота:</b>\n\n' +
    '/add — добавить токен\n' +
    '/remove — удалить токен (выбор из списка, подтверждение)\n' +
    '/list — показать ваш список отслеживаемых токенов\n' +
    '/change — изменить процент для одного токена\n' +
    '/change_all — установить одинаковый процент для всех ваших токенов\n' +
    '/reset_anchors — сбросить якорные цены ваших токенов\n' +
    '/cancel — отменить текущее действие\n' +
    '/stop — отписаться от всех алертов (удаляет ваши данные)\n';
  if (isAdmin(chatId)) {
    helpText += '/broadcast — рассылка сообщения всем пользователям (только для админа)\n';
  }
  helpText += '/delete_my_data — удалить все ваши данные\n' +
    '/privacy — показать политику конфиденциальности\n' +
    '/help — эта справка\n\n' +
    '👋 Добро пожаловать! Используйте /add для добавления первого токена.';
  sendTelegram(chatId, helpText);
}

/**
 * Handle list command
 * @param {string} chatId - User's chat ID
 * @param {Function} sendTelegram - Function to send telegram message
 * @param {Function} getUserAlerts - Function to get user alerts
 * @param {Function} escapeHtml - Function to escape HTML
 */
async function handleListCommand(chatId, sendTelegram, getUserAlerts, escapeHtml) {
  const userList = await getUserAlerts(chatId);
  if (userList.length === 0) {
    sendTelegram(chatId, '📭 У вас нет отслеживаемых токенов. Используйте /add для добавления.');
    return;
  }

  let listText = '<b>📊 Ваш список:</b>\n\n';
  userList.forEach((item, idx) => {
    const name = (item.name || item.target.address.slice(0, 8)).toUpperCase();
    listText += `${idx + 1}. <b>${escapeHtml(name)}</b> (${escapeHtml(item.target.chain)})\n`;
    listText += `   Порог: ${item.condition.changePercent}%\n\n`;
  });

  sendTelegram(chatId, listText);
}

/**
 * Handle delete my data command
 * @param {string} chatId - User's chat ID
 * @param {Function} sendTelegram - Function to send telegram message
 * @param {Function} alertsCollection - Alerts collection
 * @param {Function} usersCollection - Users collection
 */
async function handleDeleteMyData(chatId, sendTelegram, alertsCollection, usersCollection) {
  await alertsCollection.deleteMany({ ownerId: chatId });
  await usersCollection.deleteOne({ _id: chatId });
  sendTelegram(chatId, '✅ Все ваши данные удалены.');
}

/**
 * Handle stop command
 * @param {string} chatId - User's chat ID
 * @param {Function} sendTelegram - Function to send telegram message
 * @param {Function} alertsCollection - Alerts collection
 * @param {Function} usersCollection - Users collection
 */
async function handleStop(chatId, sendTelegram, alertsCollection, usersCollection) {
  await alertsCollection.deleteMany({ ownerId: chatId });
  await usersCollection.deleteOne({ _id: chatId });
  sendTelegram(chatId, '✅ Вы отписались от всех алертов. Ваши данные удалены.');
}

/**
 * Handle privacy command
 * @param {string} chatId - User's chat ID
 * @param {Function} sendTelegram - Function to send telegram message
 */
function handlePrivacy(chatId, sendTelegram) {
  sendTelegram(chatId, '<b>Политика конфиденциальности</b>\n\n' +
    'Мы храним только те данные, которые вы предоставите через бота:\n' +
    '- Ваш Telegram ID (chatId)\n' +
    '- Username (если предоставлен)\n' +
    '- Список отслеживаемых токенов: адрес, цепочка, название, порог изменения, последний сигнал цены\n' +
    '- Время последней активности\n\n' +
    'Мы не передаём ваши данные третьим лицам. Вы можете удалить все свои данные командой /delete_my_data или /stop.\n' +
    'Данные хранятся в MongoDB с ограниченным доступом (только для администратора).\n' +
    'Если у вас есть вопросы, обращайтесь к администратору.');
}

module.exports = {
  initCollections,
  handleStartHelp,
  handleListCommand,
  handleDeleteMyData,
  handleStop,
  handlePrivacy
};