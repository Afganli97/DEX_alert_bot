// ==============================
// Command handlers - all bot commands
// ==============================

const { escapeHtml, sendTelegram } = require('../lib/telegram');
const { ensureUser, isAdmin, markUserBlocked } = require('../lib/users');
const { ObjectId } = require('mongodb');

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
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000; // 30 minutes
  for (const [chatId, session] of sessions) {
    if (session.lastActivity < cutoff) {
      sessions.delete(chatId);
    }
  }
}, 5 * 60 * 1000);

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

// ============ Alert CRUD ============

/**
 * Get user's alerts
 * @param {string} ownerId - Owner's chat ID
 * @returns {Promise<Array>} User's alerts
 */
async function getUserAlerts(ownerId) {
  return await alertsCollection.find({ ownerId, source: 'dex' }).toArray();
}

/**
 * Add new alert
 * @param {string} ownerId - Owner's chat ID
 * @param {string} chain - Chain ID
 * @param {string} address - Token address
 * @param {string} name - Token name
 * @param {number} changePercent - Change threshold percent
 */
// Basic address validation (EVM or Solana format)
function isValidTokenAddress(address) {
  const isEvm = /^0x[0-9a-fA-F]{40}$/.test(address);
  const isSolana = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  return isEvm || isSolana;
}

async function addAlert(ownerId, chain, address, name, changePercent = 10) {
  // Валидация входных данных для защиты от инъекций
  if (!ownerId || typeof ownerId !== 'string') {
    throw new Error('Invalid ownerId');
  }

  if (!chain || typeof chain !== 'string' || chain.length > 50) {
    throw new Error('Invalid chain');
  }

  if (!isValidTokenAddress(address)) {
    throw new Error('Invalid token address');
  }

  if (name && (name.length > 100 || typeof name !== 'string')) {
    name = name.slice(0, 100);
  }

  const trimmedName = (name || '').slice(0, 30);

  // Validate changePercent
  if (typeof changePercent !== 'number' || changePercent <= 0 || changePercent > 1000) {
    throw new Error('Invalid changePercent value');
  }

  await alertsCollection.insertOne({
    ownerId,
    source: 'dex',
    target: {
      chain: chain.toLowerCase(),
      address: address.toLowerCase(),
    },
    condition: {
      kind: 'percent_change',
      changePercent: Number(changePercent),
      baselinePrice: null,
    },
    repeat: 'always',
    status: 'active',
    name: trimmedName,
    createdAt: new Date(),
  });
}

/**
 * Remove alert by ID
 * @param {ObjectId} alertId - Alert ID
 * @param {string} ownerId - Owner's chat ID
 */
async function removeAlert(alertId, ownerId) {
  await alertsCollection.deleteOne({ _id: alertId, ownerId });
}

/**
 * Update alert threshold
 * @param {ObjectId} alertId - Alert ID
 * @param {string} ownerId - Owner's chat ID
 * @param {number} newPercent - New threshold
 */
async function updateAlertThreshold(alertId, ownerId, newPercent) {
  if (!ownerId || typeof ownerId !== 'string') {
    throw new Error('Invalid ownerId');
  }
  if (typeof newPercent !== 'number' || newPercent <= 0 || newPercent > 1000) {
    throw new Error('Invalid newPercent value');
  }

  await alertsCollection.updateOne(
    { _id: alertId, ownerId },
    { $set: { 'condition.changePercent': Number(newPercent) } }
  );
}

/**
 * Reset all baselines for user
 * @param {string} ownerId - Owner's chat ID
 */
async function resetBaselines(ownerId) {
  if (!ownerId || typeof ownerId !== 'string') {
    throw new Error('Invalid ownerId');
  }

  await alertsCollection.updateMany(
    { ownerId },
    { $set: { 'condition.baselinePrice': null } }
  );
}

/**
 * Update threshold for all user's alerts
 * @param {string} ownerId - Owner's chat ID
 * @param {number} newPercent - New threshold
 */
async function updateAllThresholds(ownerId, newPercent) {
  if (!ownerId || typeof ownerId !== 'string') {
    throw new Error('Invalid ownerId');
  }
  if (typeof newPercent !== 'number' || newPercent <= 0 || newPercent > 1000) {
    throw new Error('Invalid newPercent value');
  }

  await alertsCollection.updateMany(
    { ownerId },
    { $set: { 'condition.changePercent': Number(newPercent) } }
  );
}

// ============ Token Info Fetch ============

/**
 * Fetch token info from DexScreener
 * @param {string} address - Token address
 * @returns {Promise<Object|null>} Token info
 */
async function fetchTokenInfo(address) {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${address}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const pairs = data?.pairs;
    if (!pairs || pairs.length === 0) return null;
    const bestPair = pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    return {
      name: (bestPair.baseToken?.symbol || 'unknown').toLowerCase(),
      chain: bestPair.chainId || 'unknown',
      address: address,
    };
  } catch (e) {
    return null;
  }
}

// ============ Message Handler ============

/**
 * Handle incoming message
 * @param {Object} msg - Telegram message object
 */
async function handleMessage(msg) {
  try {
    const chatId = msg.chat.id.toString();
    const from = msg.from;
    const username = from.username || null;
    const text = msg.text?.trim();

    if (!text) return;

    // Update user activity
    await ensureUser(chatId, username);

    // Rate limit check
    if (isRateLimited(chatId)) {
      await sendTelegram(chatId, '⚠️ Слишком много запросов. Пожалуйста, подождите перед отправкой следующей команды.');
      return;
    }

    // Get session
    const session = getSession(chatId);
    const state = session.state ?? null;
    const data = session.pendingData ?? {};

    // ---------------------- Commands ----------------------
    if (text === '/start' || text === '/help') {
      session.state = null;
      session.pendingData = {};
      let helpText = `<b>📖 Команды бота:</b>\n\n` +
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
      await sendTelegram(chatId, helpText);
      return;
    }

    if (text === '/cancel') {
      session.state = null;
      session.pendingData = {};
      await sendTelegram(chatId, '🚫 Текущее действие отменено.');
      return;
    }

    if (text === '/reset_anchors') {
      await resetBaselines(chatId);
      await sendTelegram(chatId, '🔁 Якорные цены ваших токенов сброшены. Цикл подхватит изменения автоматически.');
      return;
    }

    if (text === '/broadcast') {
      if (!isAdmin(chatId)) {
        await sendTelegram(chatId, '❌ Недоступно.');
        return;
      }
      session.state = 'awaiting_broadcast_message';
      session.pendingData = {};
      await sendTelegram(chatId, 'Введите сообщение для рассылка всем активным пользователям (максимум 1000 получателей):');
      return;
    }

    if (text === '/delete_my_data') {
      await alertsCollection.deleteMany({ ownerId: chatId });
      await usersCollection.deleteOne({ _id: chatId });
      await sendTelegram(chatId, '✅ Все ваши данные удалены.');
      return;
    }

    if (text === '/stop') {
      await alertsCollection.deleteMany({ ownerId: chatId });
      await usersCollection.deleteOne({ _id: chatId });
      await sendTelegram(chatId, '✅ Вы отписались от всех алертов. Ваши данные удалены.');
      return;
    }

    if (text === '/privacy') {
      await sendTelegram(chatId, `<b>Политика конфиденциальности</b>\n\n` +
        `Мы храним только те данные, которые вы предоставите через бота:\n` +
        `- Ваш Telegram ID (chatId)\n` +
        `- Username (если предоставлен)\n` +
        `- Список отслеживаемых токенов: адрес, цепочка, название, порог изменения, последний сигнал цены\n` +
        `- Время последней активности\n\n` +
        `Мы не передаём ваши данные третьим лицам. Вы можете удалить все свои данные командой /delete_my_data или /stop.\n` +
        `Данные хранятся в MongoDB с ограниченным доступом (только для администратора).\n` +
        `Если у вас есть вопросы, обращайтесь к администратору.`);
      return;
    }

    // ----- Admin panel -----
    if (text.startsWith('/admin')) {
      if (!isAdmin(chatId)) {
        await sendTelegram(chatId, '❌ Недоступно.');
        return;
      }
      const parts = text.trim().split(/\s+/);
      const sub = parts[1];
      switch (sub) {
        case 'stats': {
          const totalUsers = await usersCollection.countDocuments({});
          const totalAlerts = await alertsCollection.countDocuments({});
          const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
          const activeLastHour = await usersCollection.countDocuments({ lastActivityAt: { $gte: oneHourAgo }, status: 'active' });
          await sendTelegram(chatId, `<b>📊 Статистика:</b>\n` +
            `Пользователей всего: ${totalUsers}\n` +
            `Активных алертов: ${totalAlerts}\n` +
            `Активных за последний час: ${activeLastHour}`);
          break;
        }
        case 'block_user': {
          const targetId = parts[2];
          if (!targetId) {
            await sendTelegram(chatId, 'Usage: /admin block_user <chatId>');
            return;
          }
          await usersCollection.updateOne({ _id: targetId }, { $set: { status: 'blocked' } });
          await sendTelegram(chatId, `✅ Пользователь ${targetId} заблокирован.`);
          break;
        }
        case 'unblock_user': {
          const targetId = parts[2];
          if (!targetId) {
            await sendTelegram(chatId, 'Usage: /admin unblock_user <chatId>');
            return;
          }
          await usersCollection.updateOne({ _id: targetId }, { $set: { status: 'active' } });
          await sendTelegram(chatId, `✅ Пользователь ${targetId} разблокирован.`);
          break;
        }
        case 'reset_all_anchors': {
          await alertsCollection.updateMany({}, { $set: { 'condition.baselinePrice': null } });
          await sendTelegram(chatId, '✅ Якорные цены всех токенов сброшены.');
          break;
        }
        case 'view_user': {
          const targetId = parts[2];
          if (!targetId) {
            await sendTelegram(chatId, 'Usage: /admin view_user <chatId>');
            return;
          }
          const user = await usersCollection.findOne({ _id: targetId });
          if (!user) {
            await sendTelegram(chatId, 'Пользователь не найден.');
            return;
          }
          const alertCount = await alertsCollection.countDocuments({ ownerId: targetId });
          const status = user.status ?? 'unknown';
          await sendTelegram(chatId, `<b>👤 Инфо о пользователе ${targetId}:</b>\n` +
            `Статус: ${status}\n` +
            `Количество алертов: ${alertCount}`);
          break;
        }
        default:
          await sendTelegram(chatId, 'Неизвестная подкоманда. Доступные: stats, block_user, unblock_user, reset_all_anchors, view_user');
      }
      return;
    }

    // ---------------------- States ----------------------
    if (state === 'awaiting_broadcast_message') {
      const activeUsers = await usersCollection.find({ status: 'active' }).toArray();

      if (activeUsers.length > 1000) {
        await sendTelegram(chatId, `⚠️ Превышено максимальное количество получателей (${activeUsers.length}). Максимум: 1000.`);
        session.state = null;
        session.pendingData = {};
        return;
      }

      let successCount = 0;
      let failCount = 0;

      for (const user of activeUsers) {
        const ok = await sendTelegram(user._id, text);
        if (ok) successCount++;
        else failCount++;
      }

      await sendTelegram(chatId, `✅ Рассылка завершена. Успешно: ${successCount}, ошибок: ${failCount}`);
      session.state = null;
      session.pendingData = {};
      return;
    }

    if (state === 'awaiting_remove_select') {
      const num = parseInt(text);
      const userList = await getUserAlerts(chatId);
      if (isNaN(num) || num < 1 || num > userList.length) {
        await sendTelegram(chatId, '❌ Введите правильный номер токена из списка или /cancel для отмены.');
        return;
      }
      const selected = userList[num - 1];
      session.pendingData = { removeAlertId: selected._id };
      session.state = 'awaiting_remove_confirm';
      await sendTelegram(
        chatId,
        `Вы выбрали <b>${escapeHtml((selected.name || '').toUpperCase())}</b> (${escapeHtml(selected.target.chain)})\n` +
          `Адрес: <code>${escapeHtml(selected.target.address)}</code>\n\n` +
          `Удалить этот алерт? Напишите <b>yes</b> для подтверждения или <b>no</b> / /cancel для отмены.`
      );
      return;
    }

    if (state === 'awaiting_remove_confirm') {
      if (text.toLowerCase() === 'yes') {
        const { removeAlertId } = session.pendingData ?? {};
        if (removeAlertId) {
          await removeAlert(removeAlertId, chatId);
          await sendTelegram(chatId, `✅ Алерт удалён.`);
        }
      } else {
        await sendTelegram(chatId, '❌ Удаление отменено.');
      }
      session.state = null;
      session.pendingData = {};
      return;
    }

    if (state === 'awaiting_change_select') {
      const num = parseInt(text);
      const userList = await getUserAlerts(chatId);
      if (isNaN(num) || num < 1 || num > userList.length) {
        await sendTelegram(chatId, '❌ Введите правильный номер токена из списка или /cancel для отмены.');
        return;
      }
      const selected = userList[num - 1];
      session.pendingData = { changeAlertId: selected._id };
      session.state = 'awaiting_change_value';
      await sendTelegram(
        chatId,
        `Вы выбрали <b>${escapeHtml((selected.name || '').toUpperCase())}</b> (${escapeHtml(selected.target.chain)})\n` +
          `Текущий порог: ${selected.condition.changePercent}%\n` +
          `Введите новый процент изменения (например, 5 или 12.5):`
      );
      return;
    }

    if (state === 'awaiting_change_value') {
      const { changeAlertId } = session.pendingData ?? {};
      const percent = parseFloat(text);
      if (isNaN(percent) || percent <= 0) {
        await sendTelegram(chatId, '❌ Пожалуйста, введите положительное число.');
        return;
      }
      if (changeAlertId) {
        await updateAlertThreshold(changeAlertId, chatId, percent);
        await sendTelegram(chatId, `✅ Порог изменения обновлён до ${percent}%`);
      }
      session.state = null;
      session.pendingData = {};
      return;
    }

    if (state === 'awaiting_change_all_value') {
      const percent = parseFloat(text);
      if (isNaN(percent) || percent <= 0) {
        await sendTelegram(chatId, '❌ Пожалуйста, введите положительное число.');
        return;
      }
      await updateAllThresholds(chatId, percent);
      await sendTelegram(chatId, `✅ Порог изменения для всех токенов обновлён до ${percent}%`);
      session.state = null;
      session.pendingData = {};
      return;
    }

    if (state === 'awaiting_add_address') {
      const address = text.trim();
      session.pendingData = { addAddress: address };
      session.state = 'awaiting_add_confirm';

      // Fetch token info
      const tokenInfo = await fetchTokenInfo(address);
      if (!tokenInfo) {
        await sendTelegram(chatId, '❌ Не удалось получить информацию о токене. Проверьте адрес и попробуйте снова.');
        session.state = null;
        session.pendingData = {};
        return;
      }

      session.pendingData.tokenInfo = tokenInfo;
      await sendTelegram(
        chatId,
        `📊 <b>Информация о токене:</b>\n\n` +
          `<b>Сеть:</b> ${escapeHtml(tokenInfo.chain)}\n` +
          `<b>Символ:</b> ${escapeHtml(tokenInfo.name.toUpperCase())}\n` +
          `<b>Адрес:</b> <code>${escapeHtml(tokenInfo.address)}</code>\n\n` +
          `Введите порог изменения % (например, 10):`
      );
      return;
    }

    if (state === 'awaiting_add_confirm') {
      const percent = parseFloat(text);
      if (isNaN(percent) || percent <= 0) {
        await sendTelegram(chatId, '❌ Пожалуйста, введите положительное число для процента.');
        return;
      }

      const { addAddress, tokenInfo } = session.pendingData ?? {};
      if (addAddress && tokenInfo) {
        try {
          await addAlert(chatId, tokenInfo.chain, addAddress, tokenInfo.name, percent);
          await sendTelegram(
            chatId,
            `✅ Токен добавлен!\n\n` +
              `<b>${escapeHtml(tokenInfo.name.toUpperCase())}</b> (${escapeHtml(tokenInfo.chain)})\n` +
              `Порог: ${percent}%\n\n` +
              `Первый алерт будет отправлен, когда цена изменится на ${percent}% от текущей.`
          );
        } catch (e) {
          if (e.code === 11000) {
            await sendTelegram(chatId, '❌ Этот токен уже отслеживается в вашем списке.');
          } else {
            console.error('Error adding alert:', e);
            await sendTelegram(chatId, '❌ Ошибка при добавлении токена. Попробуйте позже.');
          }
        }
      }

      session.state = null;
      session.pendingData = {};
      return;
    }

    // ---------------------- Simple Commands ----------------------
    if (text === '/list') {
      const userList = await getUserAlerts(chatId);
      if (userList.length === 0) {
        await sendTelegram(chatId, '📭 У вас нет отслеживаемых токенов. Используйте /add для добавления.');
        return;
      }

      let listText = '<b>📊 Ваш список:</b>\n\n';
      userList.forEach((item, idx) => {
        const name = (item.name || item.target.address.slice(0, 8)).toUpperCase();
        listText += `${idx + 1}. <b>${escapeHtml(name)}</b> (${escapeHtml(item.target.chain)})\n`;
        listText += `   Порог: ${item.condition.changePercent}%\n\n`;
      });

      await sendTelegram(chatId, listText);
      return;
    }

    if (text === '/add') {
      session.state = 'awaiting_add_address';
      session.pendingData = {};
      await sendTelegram(chatId, 'Введите адрес токена (contract address):');
      return;
    }

    if (text === '/remove') {
      const userList = await getUserAlerts(chatId);
      if (userList.length === 0) {
        await sendTelegram(chatId, '📭 У вас нет токенов для удаления.');
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
      await sendTelegram(chatId, listText);
      return;
    }

    if (text === '/change') {
      const userList = await getUserAlerts(chatId);
      if (userList.length === 0) {
        await sendTelegram(chatId, '📭 У вас нет токенов для изменения.');
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
      await sendTelegram(chatId, listText);
      return;
    }

    if (text === '/change_all') {
      session.state = 'awaiting_change_all_value';
      session.pendingData = {};
      await sendTelegram(chatId, 'Введите новый порог изменения % для всех ваших токенов (от 0.1 до 1000):');
      return;
    }

  } catch (e) {
    console.error('handleMessage error:', e);
  }
}

module.exports = {
  initCollections,
  handleMessage,
  getUserAlerts,
  addAlert,
  removeAlert,
  updateAlertThreshold,
  resetBaselines,
  updateAllThresholds,
};