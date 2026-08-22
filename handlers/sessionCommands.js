// ==============================
// Session Commands (Multi-step flows)
// ==============================

const { escapeHtml } = require('../lib/telegram');

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

// Sessions for multi-step commands
const sessions = new Map();

/**
 * Get or create user session
 * @param {string} chatId - User's chat ID
 * @returns {Object} Session object
 */
function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, { state: null, pendingData: {}, lastActivity: Date.now() });
  }
  const s = sessions.get(chatId);
  s.lastActivity = Date.now();
  return s;
}

// Clean up inactive sessions every 5 minutes
let sessionCleanupInterval = null;

function startSessionCleanup() {
  sessionCleanupInterval = setInterval(() => {
    const cutoff = Date.now() - 30 * 60 * 1000; // 30 minutes
    for (const [chatId, session] of sessions) {
      if (session.lastActivity < cutoff) {
        sessions.delete(chatId);
      }
    }
    // Clean rate-limit timestamps older than 1 minute
    const rateLimitCutoff = Date.now() - 60 * 1000;
    for (const [chatId, arr] of commandTimestamps) {
      const filtered = arr.filter(t => t >= rateLimitCutoff);
      if (filtered.length === 0) commandTimestamps.delete(chatId);
      else commandTimestamps.set(chatId, filtered);
    }
  }, 5 * 60 * 1000);
}

function stopSessionCleanup() {
  if (sessionCleanupInterval) {
    clearInterval(sessionCleanupInterval);
    sessionCleanupInterval = null;
  }
}

/**
 * Clean up rate-limit timestamps older than 1 minute.
 * Exported for testing.
 */
function cleanupRateLimitTimestamps() {
  const rateLimitCutoff = Date.now() - 60 * 1000;
  for (const [chatId, arr] of commandTimestamps) {
    const filtered = arr.filter(t => t >= rateLimitCutoff);
    if (filtered.length === 0) commandTimestamps.delete(chatId);
    else commandTimestamps.set(chatId, filtered);
  }
}

// Rate limiting for commands
const commandTimestamps = new Map();

/**
 * Check if user is rate limited
 * @param {string} chatId - User's chat ID
 * @param {number} maxPerMinute - Max commands per minute
 * @returns {boolean} True if rate limited
 */
function isRateLimited(chatId, maxPerMinute = 10) {
  const now = Date.now();
  const arr = (commandTimestamps.get(chatId) || []).filter(t => now - t < 60000);
  arr.push(now);
  commandTimestamps.set(chatId, arr);
  return arr.length > maxPerMinute;
}

// ============ Broadcast Command Handling ============

/**
 * Handle broadcast command initiation
 * @param {string} chatId - User's chat ID
 * @param {Function} sendTelegram - Function to send telegram message
 * @param {Function} isAdmin - Function to check admin status
 * @param {Object} session - User session object
 */
function handleBroadcastStart(chatId, sendTelegram, isAdmin, session) {
  if (!isAdmin(chatId)) {
    sendTelegram(chatId, '❌ Недоступно.');
    return;
  }
  session.state = 'awaiting_broadcast_message';
  session.pendingData = {};
  sendTelegram(chatId, 'Введите сообщение для рассылка всем активным пользователям (максимум 1000 получателей):');
}

/**
 * Handle broadcast message input
 * @param {string} chatId - User's chat ID
 * @param {string} text - Message text to broadcast
 * @param {Function} sendTelegram - Function to send telegram message
 * @param {Function} escapeHtml - Function to escape HTML
 * @param {Object} session - User session object
 * @returns {Promise<void>}
 */
async function handleBroadcastMessage(chatId, text, sendTelegram, escapeHtml, session) {
  // Check limit before fetching all users to avoid unnecessary DB/memory load
  const activeCount = await usersCollection.countDocuments({ status: 'active' });
  if (activeCount > 1000) {
    console.warn('Broadcast limit exceeded:', activeCount);
    sendTelegram(chatId, `⚠️ Превышено максимальное количество получателей (${activeCount}). Максимум: 1000.`);
    session.state = null;
    session.pendingData = {};
    return;
  }

  const activeUsers = await usersCollection.find({ status: 'active' }).toArray();

  let successCount = 0;
  let failCount = 0;

  for (const user of activeUsers) {
    const ok = await sendTelegram(user._id, escapeHtml(text));
    if (ok) successCount++;
    else failCount++;
  }

  sendTelegram(chatId, `✅ Рассылка завершена. Успешно: ${successCount}, ошибок: ${failCount}`);
  session.state = null;
  session.pendingData = {};
}

// ============ Remove Alert Flow ============

/**
 * Handle remove command initiation
 * @param {string} chatId - User's chat ID
 * @param {Function} sendTelegram - Function to send telegram message
 * @param {Function} getUserAlerts - Function to get user alerts
 * @param {Function} escapeHtml - Function to escape HTML
 * @param {Object} session - User session object
 */
async function handleRemoveStart(chatId, sendTelegram, getUserAlerts, escapeHtml, session) {
  const userList = await getUserAlerts(chatId);
  if (userList.length === 0) {
    sendTelegram(chatId, '📭 У вас нет токенов для удаления.');
    return;
  }

  let listText = '<b>Выберите токен для удаления:</b>\n\n';
  userList.forEach((item, idx) => {
    const name = (item.name || item.target.address.slice(0, 8)).toUpperCase();
    listText += `${idx + 1}. <b>${escapeHtml(name)}</b> (${escapeHtml(item.target.chain)})\n`;
  });
  listText += '\nВведите номер токена или /cancel для отмены.';

  session.state = 'awaiting_remove_select';
  session.pendingData = {};
  sendTelegram(chatId, listText);
}

/**
 * Handle remove alert selection
 * @param {string} chatId - User's chat ID
 * @param {string} text - Selected token number
 * @param {Function} sendTelegram - Function to send telegram message
 * @param {Function} getUserAlerts - Function to get user alerts
 * @param {Function} escapeHtml - Function to escape HTML
 * @param {Object} session - User session object
 */
async function handleRemoveSelect(chatId, text, sendTelegram, getUserAlerts, escapeHtml, session) {
  const num = parseInt(text);
  const userList = await getUserAlerts(chatId);
  if (isNaN(num) || num < 1 || num > userList.length) {
    sendTelegram(chatId, '❌ Введите правильный номер токена из списка или /cancel для отмены.');
    return;
  }
  const selected = userList[num - 1];
  session.pendingData = { removeAlertId: selected._id };
  session.state = 'awaiting_remove_confirm';
  await sendTelegram(
    chatId,
    `Вы выбрали <b>${escapeHtml((selected.name || '').toUpperCase())}</b> (${escapeHtml(selected.target.chain)})\n` +
      `Адрес: <code>${escapeHtml(selected.target.address)}</code>\n\n` +
      'Удалить этот алерт? Напишите <b>yes</b> для подтверждения или <b>no</b> / /cancel для отмены.'
  );
}

/**
 * Handle remove alert confirmation
 * @param {string} chatId - User's chat ID
 * @param {string} text - Confirmation text (yes/no)
 * @param {Function} sendTelegram - Function to send telegram message
 * @param {Function} removeAlert - Function to remove alert
 * @param {Object} session - User session object
 */
async function handleRemoveConfirm(chatId, text, sendTelegram, removeAlert, session) {
  if (text.toLowerCase() === 'yes') {
    const { removeAlertId } = session.pendingData ?? {};
    if (removeAlertId) {
      await removeAlert(removeAlertId, chatId);
      sendTelegram(chatId, '✅ Алерт удалён.');
    }
  } else {
    sendTelegram(chatId, '❌ Удаление отменено.');
  }
  session.state = null;
  session.pendingData = {};
}

// ============ Change Threshold Flow (Single Alert) ============

/**
 * Handle change command initiation
 * @param {string} chatId - User's chat ID
 * @param {Function} sendTelegram - Function to send telegram message
 * @param {Function} getUserAlerts - Function to get user alerts
 * @param {Function} escapeHtml - Function to escape HTML
 * @param {Object} session - User session object
 */
async function handleChangeStart(chatId, sendTelegram, getUserAlerts, escapeHtml, session) {
  const userList = await getUserAlerts(chatId);
  if (userList.length === 0) {
    sendTelegram(chatId, '📭 У вас нет токенов для изменения.');
    return;
  }

  let listText = '<b>Выберите токен для изменения порога:</b>\n\n';
  userList.forEach((item, idx) => {
    const name = (item.name || item.target.address.slice(0, 8)).toUpperCase();
    listText += `${idx + 1}. <b>${escapeHtml(name)}</b> — ${item.condition.changePercent}%\n`;
  });
  listText += '\nВведите номер токена или /cancel для отмены.';

  session.state = 'awaiting_change_select';
  session.pendingData = {};
  sendTelegram(chatId, listText);
}

/**
 * Handle change threshold selection
 * @param {string} chatId - User's chat ID
 * @param {string} text - Selected token number
 * @param {Function} sendTelegram - Function to send telegram message
 * @param {Function} getUserAlerts - Function to get user alerts
 * @param {Function} escapeHtml - Function to escape HTML
 * @param {Object} session - User session object
 */
async function handleChangeSelect(chatId, text, sendTelegram, getUserAlerts, escapeHtml, session) {
  const num = parseInt(text);
  const userList = await getUserAlerts(chatId);
  if (isNaN(num) || num < 1 || num > userList.length) {
    sendTelegram(chatId, '❌ Введите правильный номер токена из списка или /cancel для отмены.');
    return;
  }
  const selected = userList[num - 1];
  session.pendingData = { changeAlertId: selected._id };
  session.state = 'awaiting_change_value';
  await sendTelegram(
    chatId,
    `Вы выбрали <b>${escapeHtml((selected.name || '').toUpperCase())}</b> (${escapeHtml(selected.target.chain)})\n` +
      `Текущий порог: ${selected.condition.changePercent}%\n` +
      'Введите новый процент изменения (например, 5 или 12.5):'
  );
}

/**
 * Handle change threshold value input
 * @param {string} chatId - User's chat ID
 * @param {string} text - New threshold value
 * @param {Function} sendTelegram - Function to send telegram message
 * @param {Function} updateAlertThreshold - Function to update alert threshold
 * @param {Object} session - User session object
 */
async function handleChangeValue(chatId, text, sendTelegram, updateAlertThreshold, session) {
  const { changeAlertId } = session.pendingData ?? {};
  const percent = parseFloat(text);
  if (isNaN(percent) || percent <= 0) {
    sendTelegram(chatId, '❌ Пожалуйста, введите положительное число.');
    return;
  }
  if (changeAlertId) {
    await updateAlertThreshold(changeAlertId, chatId, percent);
    sendTelegram(chatId, `✅ Порог изменения обновлён до ${percent}%`);
  }
  session.state = null;
  session.pendingData = {};
}

// ============ Change Threshold Flow (All Alerts) ============

/**
 * Handle change_all command initiation
 * @param {string} chatId - User's chat ID
 * @param {Function} sendTelegram - Function to send telegram message
 * @param {Object} session - User session object
 */
function handleChangeAllStart(chatId, sendTelegram, session) {
  session.state = 'awaiting_change_all_value';
  session.pendingData = {};
  sendTelegram(chatId, 'Введите новый порог изменения % для всех ваших токенов (от 0.1 до 1000):');
}

/**
 * Handle change_all threshold value input
 * @param {string} chatId - User's chat ID
 * @param {string} text - New threshold value
 * @param {Function} sendTelegram - Function to send telegram message
 * @param {Function} updateAllThresholds - Function to update all thresholds
 * @param {Object} session - User session object
 */
async function handleChangeAllValue(chatId, text, sendTelegram, updateAllThresholds, session) {
  const percent = parseFloat(text);
  if (isNaN(percent) || percent <= 0) {
    sendTelegram(chatId, '❌ Пожалуйста, введите положительное число.');
    return;
  }
  await updateAllThresholds(chatId, percent);
  sendTelegram(chatId, `✅ Порог изменения для всех токенов обновлён до ${percent}%`);
  session.state = null;
  session.pendingData = {};
}

// ============ Add Alert Flow ============

/**
 * Handle add command initiation
 * @param {string} chatId - User's chat ID
 * @param {Function} sendTelegram - Function to send telegram message
 * @param {Object} session - User session object
 */
function handleAddStart(chatId, sendTelegram, session) {
  session.state = 'awaiting_add_address';
  session.pendingData = {};
  sendTelegram(chatId, 'Введите адрес токена (contract address):');
}

/**
 * Handle add address input
 * @param {string} chatId - User's chat ID
 * @param {string} address - Token address
 * @param {Function} sendTelegram - Function to send telegram message
 * @param {Function} fetchTokenInfo - Function to fetch token info
 * @param {Function} escapeHtml - Function to escape HTML
 * @param {Object} session - User session object
 */
async function handleAddAddress(chatId, address, sendTelegram, fetchTokenInfo, escapeHtml, session) {
  const trimmedAddress = address.trim();
  session.pendingData = { addAddress: trimmedAddress };
  session.state = 'awaiting_add_confirm';

  // Validate address format before making HTTP request
  const { isValidTokenAddress } = require('../handlers/alertCommands');
  if (!isValidTokenAddress(trimmedAddress)) {
    sendTelegram(chatId, '❌ Неверный формат адреса. EVM: 0x... (40 hex), Solana: base58.');
    session.state = null;
    session.pendingData = {};
    return;
  }

  // Fetch token info
  const tokenInfo = await fetchTokenInfo(trimmedAddress);
  if (!tokenInfo) {
    sendTelegram(chatId, '❌ Не удалось получить информацию о токене. Проверьте адрес и попробуйте снова.');
    session.state = null;
    session.pendingData = {};
    return;
  }

  session.pendingData.tokenInfo = tokenInfo;
  sendTelegram(
    chatId,
    '📊 <b>Информация о токене:</b>\n\n' +
      `<b>Сеть:</b> ${escapeHtml(tokenInfo.chain)}\n` +
      `<b>Символ:</b> ${escapeHtml(tokenInfo.name.toUpperCase())}\n` +
      `<b>Адрес:</b> <code>${escapeHtml(tokenInfo.address)}</code>\n\n` +
      'Введите порог изменения % (например, 10):'
  );
}

/**
 * Handle add alert confirmation
 * @param {string} chatId - User's chat ID
 * @param {string} text - Threshold percentage
 * @param {Function} sendTelegram - Function to send telegram message
 * @param {Function} addAlert - Function to add alert
 * @param {Object} session - User session object
 */
async function handleAddConfirm(chatId, text, sendTelegram, addAlert, session) {
  const percent = parseFloat(text);
  if (isNaN(percent) || percent <= 0) {
    sendTelegram(chatId, '❌ Пожалуйста, введите положительное число для процента.');
    return;
  }

  const { addAddress, tokenInfo } = session.pendingData ?? {};
  if (addAddress && tokenInfo) {
    try {
      await addAlert(chatId, tokenInfo.chain, addAddress, tokenInfo.name, percent);
      sendTelegram(
        chatId,
        '✅ Токен добавлен!\n\n' +
          `<b>${escapeHtml(tokenInfo.name.toUpperCase())}</b> (${escapeHtml(tokenInfo.chain)})\n` +
          `Порог: ${percent}%\n\n` +
          `Первый алерт будет отправлен, когда цена изменится на ${percent}% от текущей.`
      );
    } catch (e) {
      if (e.message && e.message.startsWith('TOKEN_LIMIT_REACHED:')) {
        const limit = e.message.split(':')[1];
        sendTelegram(chatId, `❌ Лимит ${limit} токенов достигнут. Удалите ненужные токены, чтобы добавить новый.`);
      } else if (e.code === 11000) {
        sendTelegram(chatId, '❌ Этот токен уже отслеживается в вашем списке.');
      } else {
        console.error('Error adding alert:', e);
        sendTelegram(chatId, '❌ Ошибка при добавлении токена. Попробуйте позже.');
      }
    }
  }

  session.state = null;
  session.pendingData = {};
}

// ============ Reset Anchors Command ============

/**
 * Handle reset_anchors command
 * @param {string} chatId - User's chat ID
 * @param {Function} sendTelegram - Function to send telegram message
 * @param {Function} resetBaselines - Function to reset baselines
 */
async function handleResetAnchors(chatId, sendTelegram, resetBaselines) {
  await resetBaselines(chatId);
  sendTelegram(chatId, '🔁 Якорные цены ваших токенов сброшены. Цикл подхватит изменения автоматически.');
}

// ============ Cancel Command ============

/**
 * Handle cancel command
 * @param {string} chatId - User's chat ID
 * @param {Object} session - User session object
 * @param {Function} sendTelegram - Function to send telegram message
 */
async function handleCancel(chatId, session, sendTelegram) {
  session.state = null;
  session.pendingData = {};
  await sendTelegram(chatId, '🚫 Текущее действие отменено.');
}

module.exports = {
  initCollections,
  getSession,
  isRateLimited,
  startSessionCleanup,
  stopSessionCleanup,
  cleanupRateLimitTimestamps,
  commandTimestamps,
  // Broadcast
  handleBroadcastStart,
  handleBroadcastMessage,
  // Remove
  handleRemoveStart,
  handleRemoveSelect,
  handleRemoveConfirm,
  // Change single
  handleChangeStart,
  handleChangeSelect,
  handleChangeValue,
  // Change all
  handleChangeAllStart,
  handleChangeAllValue,
  // Add
  handleAddStart,
  handleAddAddress,
  handleAddConfirm,
  // Other
  handleResetAnchors,
  handleCancel
};