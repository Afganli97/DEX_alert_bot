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
let needRestart = false;
let shuttingDown = false;

// Состояния пользователей (для многоэтапных команд)
const userState = new Map();   // chatId -> state string
const pendingData = new Map(); // chatId -> { ... }

// Rate limiting для Telegram (глобально, достаточно для ограниченного количества сообщений)
let lastTelegramSendTime = 0;

// ---------- HTML-экранирование ----------
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');
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
  await usersCollection.createIndex({ username: 1 }, { unique: true, sparse: true });

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
      $set: { lastActivityAt: new Date() },
      $setOnInsert: { username: username || null },
    },
    { upsert: true, returnDocument: 'after' }
  );
  return doc.value;
}

// ---------- Watchlist ----------
async function getWatchlistItems() {
  return await watchlistCollection.find({}).toArray();
}

async function getUserWatchlist(chatId) {
  return await watchlistCollection.find({ ownerId: chatId }).toArray();
}

async function addWatchlistItem(ownerId, chain, address, name, changeAlert = 10) {
  await watchlistCollection.insertOne({
    ownerId,
    chain: chain.toLowerCase(),
    address: address.toLowerCase(),
    name: name || '',
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

async function updateWatchlistLastAlertPrice(itemId, price) {
  await watchlistCollection.updateOne(
    { _id: itemId },
    { $set: { lastAlertPrice: price } }
  );
}

async function getWatchlistItem(itemId, ownerId) {
  return await watchlistCollection.findOne({ _id: itemId, ownerId });
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

// ---------- Отправка сообщения с rate limiting и retry ----------
async function sendTelegram(chatId, text) {
  let retries = 3;
  while (retries > 0) {
    try {
      const now = Date.now();
      const wait = Math.max(0, TELEGRAM_MIN_INTERVAL - (now - lastTelegramSendTime));
      if (wait > 0) await new Promise(r => setTimeout(r, wait));

      const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
      lastTelegramSendTime = Date.now();

      const data = await res.json();
      if (data.ok) {
        console.log(`✅ Сообщение отправлено в чат ${chatId}`);
        return;
      } else {
        console.error(`❌ Ошибка Telegram API (осталось попыток: ${retries - 1}):`, data);
        retries--;
        if (retries > 0) {
          await new Promise(r => setTimeout(r, (4 - retries) * 1000));
        }
      }
    } catch (e) {
      console.error(`❌ Ошибка отправки (осталось попыток: ${retries - 1}):`, e);
      retries--;
      if (retries > 0) {
        await new Promise(r => setTimeout(r, (4 - retries) * 1000));
      }
    }
  }
  console.error(`❌ Не удалось отправить сообщение в чат ${chatId} после всех попыток`);
}

// ---------- Основной цикл проверки цен ----------
async function runCycle() {
  if (shuttingDown) return;
  const allItems = await getWatchlistItems();
  if (allItems.length === 0) {
    //console.log('📭 Список отслеживания пуст, пропускаем цикл');
    return;
  }

  // Сгруппировать уникальные адреса по цепочке
  const uniqueByChain = new Map(); // chain -> Set<address>
  for (const item of allItems) {
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
    const cached = priceCache.get(`${item.chain}:${item.address}`);
    if (!cached) continue;

    // Если якорная цена не установлена – сохраняем текущую как якорь и пропускаем алерт
    if (item.lastAlertPrice == null) {
      await updateWatchlistLastAlertPrice(item._id, cached.price);
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
      // Обновляем якорную price после отправки алерта
      await updateWatchlistLastAlertPrice(item._id, cached.price);
    }
  }

  // Отправляем уведомления
  for (const alert of alerts) {
    await sendTelegram(alert.chatId, alert.text);
  }
}

// ---------- Обработка сообщений ----------
async function handleMessage(msg) {
  const chatId = msg.chat.id.toString();
  const from = msg.from;
  const username = from.username || null;
  const text = msg.text?.trim();

  if (!text) return;

  // Обновляем активность пользователя
  await ensureUser(chatId, username);

  // Инициализируем состояние пользователя, если ещё нет
  if (!userState.has(chatId)) {
    userState.set(chatId, null);
    pendingData.set(chatId, {});
  }

  const state = userState.get(chatid) ?? null;
  const data = pendingData.get(chatid) ?? {};

  // ---------------------- Команды ----------------------
  if (text === '/start' || text === '/help') {
    userState.set(chatId, null);
    pendingData.set(chatId, {});
    await sendTelegram(
      chatId,
      `<b>📖 Команды бота:</b>\n\n` +
        '/add — добавить токен\n' +
        '/remove — удалить токен (выбор из списка, подтверждение)\n' +
        '/list — показать ваш список отслеживаемых токенов\n' +
        '/change — изменить процент для одного токена\n' +
        '/change_all — установить одинаковый процент для всех ваших токенов\n' +
        '/reset_anchors — сбросить якорные цены ваших токенов\n' +
        '/cancel — отменить текущее действие\n' +
        '/help — эта справка'
    );
    return;
  }
  if (text === '/cancel') {
    userState.set(chatId, null);
    pendingData.set(chatId, {});
    await sendTelegram(chatId, '🚫 Текущее действие отменено.');
    return;
  }
  if (text === '/reset_anchors') {
    await resetWatchlistAnchors(chatId);
    needRestart = true;
    await sendTelegram(chatId, '🔁 Якорные цены ваших токенов сброшены. Цикл будет перезапущен.');
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
    pendingData.set(chatId, { removeTokenId: selected._id });
    userState.set(chatId, 'awaiting_remove_confirm');
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
      const { removeTokenId } = pendingData.get(chatid) ?? {};
      if (removeTokenId) {
        await removeWatchlistItem(removeTokenId, chatId);
        needRestart = true;
        await sendTelegram(chatId, `✅ Токен удалён из вашего отслеживания.`);
      }
    } else {
      await sendTelegram(chatId, '❌ Удаление отменено.');
    }
    userState.set(chatId, null);
    pendingData.set(chatId, {});
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
    pendingData.set(chatId, { changeTokenId: selected._id });
    userState.set(chatId, 'awaiting_change_value');
    await sendTelegram(
      chatId,
      `Вы выбрали <b>${escapeHtml(selected.name.toUpperCase())}</b> (${escapeHtml(selected.chain)})\n` +
        `Текущий порог: ${selected.changeAlert}%\n` +
        `Введите новый процент изменения (например, 5 или 12.5):`
    );
    return;
  }
  if (state === 'awaiting_change_value') {
    const { changeTokenId } = pendingData.get(chatid) ?? {};
    const percent = parseFloat(text);
    if (isNaN(percent) || percent <= 0) {
      await sendTelegram(chatId, '❌ Пожалуйста, введите положительное число (процент).');
      return;
    }
    if (changeTokenId) {
      await updateWatchlistAlert(changeTokenId, chatId, percent);
      needRestart = true;
      await sendTelegram(chatId, `✅ Порог изменён на ${percent}% для выбранного токена.`);
    }
    userState.set(chatId, null);
    pendingData.set(chatid, {});
    return;
  }
  if (state === 'awaiting_change_all_value') {
    const percent = parseFloat(text);
    if (isNaN(percent) || percent <= 0) {
      await sendTelegram(chatId, '❌ Пожалуйста, введите положительное число (процент).');
      return;
    }
    await updateWatchlistAlertMany(chatId, percent); // we'll define this helper shortly
    needRestart = true;
    await sendTelegram(chatId, `✅ Порог изменён на ${percent}% для всех ваших токенов.`);
    userState.set(chatId, null);
    pendingData.set(chatid, {});
    return;
  }

  // ---------------------- Основные команды ----------------------
  if (text === '/add') {
    userState.set(chatId, 'awaiting_add_address');
    pendingData.set(chatid, {});
    await sendTelegram(chatId, 'Введите адрес контракта токена (например, 0x... или адрес Solana):');
    return;
  }
  if (state === 'awaiting_add_address') {
    const address = text;
    // Basic validation: not empty
    if (!address || address.length < 5) {
      await sendTelegram(chatId, '❌ Адрес выглядит некорректно. Попробуйте ещё раз или /cancel.');
      return;
    }
    const info = await fetchTokenInfo(address);
    if (!info) {
      await sendTelegram(chatId, '❌ Не удалось получить информацию о токене по этому адресу. Проверьте адрес и попробуйте снова или /cancel.');
      return;
    }
    // Check if already exists for this user
    const exists = await watchlistCollection.findOne({
      ownerId: chatId,
      address: info.address.toLowerCase(),
      chain: info.chain.toLowerCase(),
    });
    if (exists) {
      await sendTelegram(chatId, `⚠️ Токен ${escapeHtml(info.name.toUpperCase())} уже есть в вашем списке.`);
      userState.set(chatid, null);
      pendingData.set(chatid, {});
      return;
    }
    pendingData.set(chatid, { newTokenInfo: info });
    userState.set(chatid, 'awaiting_add_threshold');
    await sendTelegram(
      chatId,
      `Найден токен: <b>${escapeHtml(info.name.toUpperCase())}</b> (${escapeHtml(info.chain)})\n` +
        `Введите процент изменения для оповещения (например, 10):`
    );
    return;
  }
  if (state === 'awaiting_add_threshold') {
    const { newTokenInfo } = pendingData.get(chatid) ?? {};
    const percent = parseFloat(text);
    if (isNaN(percent) || percent <= 0) {
      await sendTelegram(chatId, '❌ Пожалуйста, введите положительное число (процент).');
      return;
    }
    await addWatchlistItem(
      chatId,
      newTokenInfo.chain,
      newTokenInfo.address,
      newTokenInfo.name,
      percent
    );
    needRestart = true;
    await sendTelegram(
      chatId,
      `✅ Токен <b>${escapeHtml(newTokenInfo.name.toUpperCase())}</b> добавлен с порогом ${percent}%.`
    );
    userState.set(chatid, null);
    pendingData.set(chatid, {});
    return;
  }
  if (text === '/list') {
    const userList = await getUserWatchlist(chatId);
    if (userList.length === 0) {
      await sendTelegram(chatId, '📭 Ваш список отслеживания пуст.');
      return;
    }
    let msg = '<b>📋 Ваш список отслеживаемых токенов:</b>\n';
    userList.forEach((item, idx) => {
      msg += `${idx + 1}. <b>${escapeHtml(item.name.toUpperCase())}</b> (${escapeHtml(item.chain)}) – ${item.changeAlert}%\n`;
    });
    await sendTelegram(chatId, msg);
    return;
  }
  if (text === '/change') {
    const userList = await getUserWatchlist(chatId);
    if (userList.length === 0) {
      await sendTelegram(chatId, '📭 Ваш список отслеживания пуст. Сначала добавьте токены через /add.');
      return;
    }
    let msg = '<b>Выберите токен для изменения порога:</b>\n';
    userList.forEach((item, idx) => {
      msg += `${idx + 1}. <b>${escapeHtml(item.name.toUpperCase())}</b> (${escapeHtml(item.chain)}) – текущий ${item.changeAlert}%\n`;
    });
    userState.set(chatid, 'awaiting_change_select');
    pendingData.set(chatid, {});
    await sendTelegram(chatId, msg);
    return;
  }
  if (text === '/change_all') {
    const userList = await getUserWatchlist(chatId);
    if (userList.length === 0) {
      await sendTelegram(chatId, '📭 Ваш список отслеживания пуст. Сначала добавьте токены через /add.');
      return;
    }
    userState.set(chatid, 'awaiting_change_all_value');
    pendingData.set(chatid, {});
    await sendTelegram(chatId, 'Введите процент изменения, который будет установлен для всех ваших токенов:');
    return;
  }

  // Если ничего не подошло – просто игнорируем (или можно отправить напомнние о /help)
}

// ---------- Обновление многих записей (для /change_all) ----------
async function updateWatchlistAlertMany(ownerId, newPercent) {
  await watchlistCollection.updateMany(
    { ownerId },
    { $set: { changeAlert: Number(newPercent) } }
  );
}

// ---------- Планировщик циклов с интервалом 20 секунд ----------
async function scheduleNext() {
  if (shuttingDown) return;
  await runCycle();
  setTimeout(scheduleNext, CYCLE_INTERVAL_MS);
}

// ---------- Long Polling со встроенным fetch и таймаутом ----------
async function startPolling() {
  let offset = 0;
  console.log('🤖 Long polling started');
  while (!shuttingDown) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`${TELEGRAM_API}/getUpdates?offset=${offset}&timeout=10`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (typeof data === 'object' && data !== null && data.ok && data.result.length > 0) {
        for (const upd of data.result) {
          offset = upd.update_id + 1;
          if (upd.message) await handleMessage(upd.message);
        }
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        console.log('Polling timeout, restarting...');
      } else {
        console.error('Polling error:', e);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }
  console.log('Long polling остановлен (shutdown)');
}

// ---------- Graceful shutdown ----------
function gracefulShutdown() {
  console.log('Получен сигнал завершения, ожидаем завершения текущего цикла...');
  shuttingDown = true;
  const forceExitTimeout = setTimeout(() => {
    console.error('Принудительный выход по таймауту');
    process.exit(0);
  }, 15000);
  const checkInterval = setInterval(() => {
    if (!isChecking) {
      clearTimeout(forceExitTimeout);
      clearInterval(checkInterval);
      console.log('Цикл завершён, выход');
      process.exit(0);
    }
  }, 200);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// ---------- Старт ----------
(async () => {
  await connectToMongo();
  scheduleNext();
  startPolling();
})();