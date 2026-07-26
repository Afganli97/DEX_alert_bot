// ==============================
// DEX ALERT BOT (Multi-user version)
// ==============================
require('dotenv').config();
const { MongoClient } = require('mongodb');

// ---------- Проверка обязательных переменных окружения ----------
const requiredEnv = ['TELEGRAM_TOKEN', 'MONGO_URI'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`❌ Отсутствует обязательная переменная окружения: ${key}`);
    process.exit(1);
  }
}

// ---------- Конфигурация ----------
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_IDS = (process.env.ADMIN_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const BATCH_SIZE = 30;                 // максимум адресов в одном запросе к DexScreener
const BATCH_DELAY_MS = 1000;          // пауза между батчами (1 секунда)
const CYCLE_INTERVAL_MS = 20000;      // интервал между циклами проверки (20 секунд)
const TELEGRAM_MIN_INTERVAL = 500;    // минимальный интервал между отправками сообщений (мс)

// ---------- Глобальные переменные ----------
let db;
let usersCollection;
let watchlistCollection;
let isChecking = false;
let shuttingDown = false;

// ---------- Сессии пользователей (для многоэтапных команд) ----------
const sessions = new Map(); // chatId -> { state, pendingData, lastActivity }

function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, { state: null, pendingData: {}, lastActivity: Date.now() });
  }
  const s = sessions.get(chatId);
  s.lastActivity = Date.now();
  return s;
}

// Очистка неактивных сессий каждые 5 минут
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000; // 30 минут
  for (const [chatId, session] of sessions) {
    if (session.lastActivity < cutoff) {
      sessions.delete(chatId);
    }
  }
}, 5 * 60 * 1000);

// ---------- Rate limiting for commands ----------
const commandTimestamps = new Map();
function isRateLimited(chatId, maxPerMinute = 10) {
  const now = Date.now();
  const arr = (commandTimestamps.get(chatId) || []).filter(t => now - t < 60000);
  arr.push(now);
  commandTimestamps.set(chatId, arr);
  return arr.length > maxPerMinute;
}

// ---------- HTML-экранирование ----------
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');
}

// ---------- Утилита сна ----------
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------- Подключение к MongoDB ----------
async function connectToMongo() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db();
  usersCollection = db.collection('users');
  watchlistCollection = db.collection('watchlist');

  // Индексы
  await watchlistCollection.createIndex({ ownerId: 1, address: 1 }, { unique: true });
  await watchlistCollection.createIndex({ chain: 1, address: 1 });
  await usersCollection.createIndex({ _id: 1 });
  await usersCollection.createIndex({ username: 1 });

  console.log('✅ Подключено к MongoDB');
}

// ---------- Пользователи ----------
async function ensureUser(chatId, username) {
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

// ---------- Проверка админа ----------
function isAdmin(chatId) {
  return ADMIN_IDS.includes(chatId);
}

// ---------- Watchlist ----------
async function getWatchlistItems() {
  return await watchlistCollection.find({}).toArray();
}

async function getUserWatchlist(chatId) {
  return await watchlistCollection.find({ ownerId: chatId }).toArray();
}

async function addWatchlistItem(ownerId, chain, address, name, changeAlert = 10) {
  const trimmedName = (name || '').slice(0, 30);
  await watchlistCollection.insertOne({
    ownerId,
    chain: chain.toLowerCase(),
    address: address.toLowerCase(),
    name: trimmedName,
    changeAlert: Number(changeAlert),
    lastAlertPrice: null,
    createdAt: new Date(),
  });
}

async function removeWatchlistItem(itemId, ownerId) {
  await watchlistCollection.deleteOne({ _id: itemId, ownerId });
}

async function updateWatchlistAlert(itemId, ownerId, newPercent) {
  await watchlistCollection.updateOne(
    { _id: itemId, ownerId },
    { $set: { changeAlert: Number(newPercent) } }
  );
}

async function resetWatchlistAnchors(ownerId) {
  await watchlistCollection.updateMany(
    { ownerId },
    { $set: { lastAlertPrice: null } }
  );
}

async function updateWatchlistLastAlertPrice(itemId, ownerId, price) {
  await watchlistCollection.updateOne(
    { _id: itemId, ownerId },
    { $set: { lastAlertPrice: price } }
  );
}

async function getWatchlistItem(itemId, ownerId) {
  return await watchlistCollection.findOne({ _id: itemId, ownerId });
}

async function updateWatchlistAlertMany(ownerId, newPercent) {
  await watchlistCollection.updateMany(
    { ownerId },
    { $set: { changeAlert: Number(newPercent) } }
  );
}

// ---------- Получение информации о токене (для добавления) ----------
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

// ---------- Пакетный запрос цен для группы адресов (одна сеть) ----------
async function fetchBatchPrices(chainId, addresses) {
  const url = `https://api.dexscreener.com/tokens/v1/${chainId}/${addresses.join(',')}`;
  const maxRetries = 3;
  let delay = 2000;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.status === 429) {
        console.log(`⚠️ 429 Too Many Requests, попытка ${attempt + 1}/${maxRetries}, ждём ${delay / 1000}с...`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
        continue;
      }

      if (!res.ok) {
        console.log(`❌ HTTP ${res.status} для ${chainId} батча`);
        return {};
      }

      const data = await res.json();
      const pairs = Array.isArray(data) ? data : (data?.pairs || []);

      const resultMap = {};
      for (const pair of pairs) {
        const addr = pair?.baseToken?.address?.toLowerCase();
        if (!addr) continue;
        const liquidity = parseFloat(pair?.liquidity?.usd || 0);
        const current = resultMap[addr];
        if (!current || liquidity >= current.liquidity) {
          resultMap[addr] = {
            price: parseFloat(pair.priceUsd || 0),
            url: pair.url || '',
            symbol: pair?.baseToken?.symbol || 'UNKNOWN',
            liquidity,
          };
        }
      }
      return resultMap;
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log(`⏱️ Timeout для ${chainId} батча, попытка ${attempt + 1}`);
      } else {
        console.error(`❌ Ошибка пакетного запроса (${chainId}):`, err);
      }
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      }
    }
  }
  console.error(`❌ Не удалось получить данные для ${chainId} после ${maxRetries} попыток, пропущено адресов: ${addresses.length}`);
  return {};
}

// ---------- Форматирование цены ----------
function formatPrice(price) {
  if (price < 0.0001) return price.toExponential(3);
  if (price < 1) return price.toPrecision(4);
  return price.toFixed(4);
}

// ---------- Очередь отправки в Telegram с обработкой rate limit и ошибок ----------
class TelegramQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
  }
  push(chatId, text) {
    return new Promise((resolve, reject) => {
      this.queue.push({ chatId, text, resolve, reject });
      this.process();
    });
  }
  async process() {
    if (this.processing) return;
    this.processing = true;
    while (this.queue.length) {
      const { chatId, text, resolve, reject } = this.queue.shift();
      try {
        const ok = await sendTelegramTo(chatId, text);
        // always resolve boolean, never reject on expected failures (403 etc.)
        resolve(ok);
      } catch (err) {
        console.error('Queue send error:', err);
        resolve(false);
      }
      await sleep(35); // ~28 msg/сек, с запасом от лимита 30/сек
    }
    this.processing = false;
  }
}

const telegramQueue = new TelegramQueue();

async function sendTelegramTo(chatId, text) {
  try {
    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json();
    if (data.ok) return true;

    if (data.error_code === 403) {
      // Пользователь заблокировал бота — не ретраим, помечаем как blocked
      await usersCollection.updateOne({ _id: chatId }, { $set: { status: 'blocked' } });
      return false;
    }
    if (data.error_code === 429 && data.parameters?.retry_after) {
      await sleep(data.parameters.retry_after * 1000);
      // Одна повторная попытка после выдержки
      const retryRes = await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
      const retryData = await retryRes.json();
      return retryData.ok;
    }
    console.error('Telegram error:', data);
    return false;
  } catch (e) {
    console.error('Send error:', e);
    return false;
  }
}

// ---------- Обёртка для отправки через очередь ----------
async function sendTelegram(chatId, text) {
  return telegramQueue.push(chatId, text);
}

// ---------- Основной цикл проверки цен ----------
async function runCycle() {
  if (shuttingDown || isChecking) return;
  isChecking = true;
  try {
    const allItems = await getWatchlistItems();
    if (allItems.length === 0) {
      return;
    }

    // Фильтрация заблокированных пользователей: получаем всех blocked заранее
    const blockedUsersSet = new Set();
    const blockedCursor = await usersCollection.find({ status: 'blocked' }, { projection: { _id: 1 } });
    await blockedCursor.forEach(doc => blockedUsersSet.add(doc._id));

    // Сгруппировать уникальные адреса по цепочке, исключая заблокированных
    const uniqueByChain = new Map(); // chain -> Set<address>
    for (const item of allItems) {
      if (blockedUsersSet.has(item.ownerId)) {
        continue;
      }
      if (!uniqueByChain.has(item.chain)) {
        uniqueByChain.set(item.chain, new Set());
      }
      uniqueByChain.get(item.chain).add(item.address);
    }

    const priceCache = new Map(); // "chain:address" -> {price, symbol, url}
    for (const [chain, addrSet] of uniqueByChain) {
      const addresses = [...addrSet];
      for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
        const batch = addresses.slice(i, i + BATCH_SIZE);
        const data = await fetchBatchPrices(chain, batch);
        for (const [addr, info] of Object.entries(data)) {
          priceCache.set(`${chain}:${addr}`, info);
        }
        if (i + BATCH_SIZE < addresses.length) {
          await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
        }
      }
    }

    const alerts = []; // {chatId, text, itemId}
    for (const item of allItems) {
      if (blockedUsersSet.has(item.ownerId)) {
        continue;
      }
      const cached = priceCache.get(`${item.chain}:${item.address}`);
      if (!cached) continue;

      // Если якорная цена не установлена – сохраняем текущую как якорь и пропускаем алерт
      if (item.lastAlertPrice == null) {
        await updateWatchlistLastAlertPrice(item._id, item.ownerId, cached.price);
        continue;
      }

      const changePct = ((cached.price - item.lastAlertPrice) / item.lastAlertPrice) * 100;
      if (Math.abs(changePct) >= item.changeAlert) {
        const dir = changePct > 0 ? '🚀' : '🔻';
        const sign = changePct > 0 ? '+' : '';
        const escapedSymbol = escapeHtml(cached.symbol.toUpperCase());
        const escapedUrl = escapeHtml(cached.url);
        const message = `${dir} <a href="${escapedUrl}">${escapedSymbol}</a> ${sign}${changePct.toFixed(2)}%\nЦена: $${formatPrice(cached.price)}`;
        alerts.push({
          chatId: item.ownerId,
          text: message,
          itemId: item._id,
        });
        // Обновляем якорную цену после отправки алерта
        await updateWatchlistLastAlertPrice(item._id, item.ownerId, cached.price);
      }
    }

    // Отправляем уведомления через очередь
    for (const alert of alerts) {
      await sendTelegram(alert.chatId, alert.text);
    }
  } finally {
    isChecking = false;
  }
}

// ---------- Обработка сообщений ----------
async function handleMessage(msg) {
  try {
    const chatId = msg.chat.id.toString();
    const from = msg.from;
    const username = from.username || null;
    const text = msg.text?.trim();

    if (!text) return;

    // Обновляем активность пользователя
    await ensureUser(chatId, username);

    // Проверка лимита команд
    if (isRateLimited(chatId)) {
      await sendTelegram(chatId, '⚠️ Слишком много запросов. Пожалуйста, подождите перед отправкой следующей команды.');
      return;
    }

    // Инициализируем состояние пользователя, если ещё нет
    if (!sessions.has(chatId)) {
      sessions.set(chatId, { state: null, pendingData: {}, lastActivity: Date.now() });
    }
    const session = getSession(chatId);
    const state = session.state ?? null;
    const data = session.pendingData ?? {};

    // ---------------------- Команды ----------------------
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
        '👋 Добро прижал! Используйте /add для добавления первого токена.';
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
      await resetWatchlistAnchors(chatId);
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
      await sendTelegram(chatId, 'Введите сообщение для рассылки всем активным пользователям:');
      return;
    }
    if (text === '/delete_my_data') {
      await watchlistCollection.deleteMany({ ownerId: chatId });
      await usersCollection.deleteOne({ _id: chatId });
      await sendTelegram(chatId, '✅ Все ваши данные удалены.');
      return;
    }
    if (text === '/stop') {
      await watchlistCollection.deleteMany({ ownerId: chatId });
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
          const totalWatchlist = await watchlistCollection.countDocuments({});
          const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
          const activeLastHour = await usersCollection.countDocuments({ lastActivityAt: { $gte: oneHourAgo }, status: 'active' });
          await sendTelegram(chatId, `<b>📊 Статистика:</b>\n` +
            `Пользователей всего: ${totalUsers}\n` +
            `Записей в watchlist: ${totalWatchlist}\n` +
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
          await watchlistCollection.updateMany({}, { $set: { lastAlertPrice: null } });
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
          const tokenCount = await watchlistCollection.countDocuments({ ownerId: targetId });
          const status = user.status ?? 'unknown';
          await sendTelegram(chatId, `<b>👤 Инфо о пользователе ${targetId}:</b>\n` +
            `Статус: ${status}\n` +
            `Количество токенов в watchlist: ${tokenCount}`);
          break;
        }
        default:
          await sendTelegram(chatId, 'Неизвестная подкоманда. Доступные: stats, block_user, unblock_user, reset_all_anchors, view_user');
      }
      return;
    }

    // ---------------------- Состояния ----------------------
    if (state === 'awaiting_remove_select') {
      const num = parseInt(text);
      const userList = await getUserWatchlist(chatId);
      if (isNaN(num) || num < 1 || num > userList.length) {
        await sendTelegram(chatId, '❌ Введите правильный номер токена из списка или /cancel для отмены.');
        return;
      }
      const selected = userList[num - 1];
      session.pendingData = { removeTokenId: selected._id };
      session.state = 'awaiting_remove_confirm';
      await sendTelegram(
        chatId,
        `Вы выбрали <b>${escapeHtml(selected.name.toUpperCase())}</b> (${escapeHtml(selected.chain)})\n` +
          `Адрес: <code>${escapeHtml(selected.address)}</code>\n\n` +
          `Удалить этот токен? Напишите <b>yes</b> для подтверждения или <b>no</b> / /cancel для отмены.`
      );
      return;
    }
    if (state === 'awaiting_remove_confirm') {
      if (text.toLowerCase() === 'yes') {
        const { removeTokenId } = session.pendingData ?? {};
        if (removeTokenId) {
          await removeWatchlistItem(removeTokenId, chatId);
          await sendTelegram(chatId, `✅ Токен удалён из вашего отслеживания.`);
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
      const userList = await getUserWatchlist(chatId);
      if (isNaN(num) || num < 1 || num > userList.length) {
        await sendTelegram(chatId, '❌ Введите правильный номер токена из списка или /cancel для отмены.');
        return;
      }
      const selected = userList[num - 1];
      session.pendingData = { changeTokenId: selected._id };
      session.state = 'awaiting_change_value';
      await sendTelegram(
        chatId,
        `Вы выбрали <b>${escapeHtml(selected.name.toUpperCase())}</b> (${escapeHtml(selected.chain)})\n` +
          `Текущий порог: ${selected.changeAlert}%\n` +
          `Введите новый процент изменения (например, 5 или 12.5):`
      );
      return;
    }
    if (state === 'awaiting_change_value') {
      const { changeTokenId } = session.pendingData ?? {};
      const percent = parseFloat(text);
      if (isNaN(percent) || percent <= 0) {
        await sendTelegram(chatId, '❌ Пожалуй