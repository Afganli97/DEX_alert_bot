// ==============================
// DEX ALERT BOT MONITOR (standalone monitor)
// ==============================
// This is a standalone entry point that can be scheduled
// to run the monitoring cycle on demand (e.g., via cron/heartbeat).
// It connects to DB, runs the monitoring cycle, and exits.
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

// ---------- Глобальные переменные (minimal) ----------
let db;
let usersCollection;
let watchlistCollection;
let isChecking = false;
let shuttingDown = false;

// ---------- Сессии (minimal, not used in standalone run) ----------
const sessions = new Map();

function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, { state: null, pendingData: {}, lastActivity: Date.now() });
  }
  const s = sessions.get(chatId);
  s.lastActivity = Date.now();
  return s;
}

// ---------- Rate limiting (not used in standalone run) ----------
const commandTimestamps = new Map();
function isRateLimited(chatId, maxPerMinute = 10) {
  return false; // Not used in standalone mode
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
  const client = new MongoClient(process.env.MONGO_URI);
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
  const adminIds = (process.env.ADMIN_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  return adminIds.includes(chatId);
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

// ---------- Получение информации о токене ----------
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

// ---------- Пакетный запрос цен ----------
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

// ---------- Telegram queue ----------
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
        resolve(ok);
      } catch (err) {
        console.error('Queue send error:', err);
        resolve(false);
      }
      await sleep(35);
    }
    this.processing = false;
  }
}

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}`;
const BATCH_DELAY_MS = 1000;
const TELEGRAM_MIN_INTERVAL = 500;

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
      await usersCollection.updateOne({ _id: chatId }, { $set: { status: 'blocked' } });
      return false;
    }
    if (data.error_code === 429 && data.parameters?.retry_after) {
      await sleep(data.parameters.retry_after * 1000);
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
      console.log('⏸️ Нет записей в watchlist - алерт не запущен');
      return;
    }
    console.log(`✅_started_监控循环: ${allItems.length} записей в watchlist`);

    // Фильтрация заблокированных пользователей
    const blockedUsersSet = new Set();
    const blockedCursor = await usersCollection.find({ status: 'blocked' }, { projection: { _id: 1 } });
    await blockedCursor.forEach(doc => blockedUsersSet.add(doc._id));

    // Сгруппировать уникальные адреса по цепочке, исключая заблокированных
    const uniqueByChain = new Map();
    for (const item of allItems) {
      if (blockedUsersSet.has(item.ownerId)) {
        continue;
      }
      if (!uniqueByChain.has(item.chain)) {
        uniqueByChain.set(item.chain, new Set());
      }
      uniqueByChain.get(item.chain).add(item.address);
    }

    const priceCache = new Map();
    const BATCH_SIZE = 30;
    const BATCH_DELAY = 1000;

    for (const [chain, addrSet] of uniqueByChain) {
      const addresses = [...addrSet];
      for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
        const batch = addresses.slice(i, i + BATCH_SIZE);
        const data = await fetchBatchPrices(chain, batch);
        for (const [addr, info] of Object.entries(data)) {
          priceCache.set(`${chain}:${addr}`, info);
        }
        if (i + BATCH_SIZE < addresses.length) {
          await new Promise(r => setTimeout(r, BATCH_DELAY));
        }
      }
    }

    const alerts = [];
    for (const item of allItems) {
      if (blockedUsersSet.has(item.ownerId)) {
        continue;
      }
      const cached = priceCache.get(`${item.chain}:${item.address}`);
      if (!cached) continue;

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
        await updateWatchlistLastAlertPrice(item._id, item.ownerId, cached.price);
      }
    }

    // Отправляем уведомления
    for (const alert of alerts) {
      await sendTelegram(alert.chatId, alert.text);
    }

    console.log(`✅_monitor_cycle_complete: ${alerts.length} уведомлений отправлено`);
  } finally {
    isChecking = false;
  }
}

// ---------- Запуск ----------
async function main() {
  await connectToMongo();
  await runCycle();
  // Close connection after cycle
  try {
    if (db && db.client) await db.client.close();
  } catch (e) {
    console.error('Ошибка закрытия MongoDB:', e);
  }
  process.exit(0);
}

main().catch(err => {
  console.error('❌ ошибка в monitor.js:', err);
  process.exit(1);
});