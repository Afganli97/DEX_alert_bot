// ==============================
// DEX ALERT BOT (Polling + пакетные запросы к DexScreener)
// Полный код с улучшениями надёжности
// ==============================
require('dotenv').config();
const { MongoClient } = require('mongodb');

// ---------- Проверка обязательных переменных окружения ----------
const requiredEnv = ['TELEGRAM_TOKEN', 'CHAT_ID', 'MONGO_URI'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`❌ Отсутствует обязательная переменная окружения: ${key}`);
    process.exit(1);
  }
}

// ---------- Конфигурация ----------
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const MONGO_URI = process.env.MONGO_URI;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const BATCH_SIZE = 30;                 // максимум адресов в одном запросе к DexScreener
const BATCH_DELAY_MS = 1000;          // пауза между батчами (1 секунда)
const CYCLE_INTERVAL_MS = 20000;      // интервал между циклами проверки (20 секунд)

// ---------- Глобальные переменные ----------
let db;
let tokensCollection;
let isChecking = false;
let needRestart = false;

let userState = null;
let pendingData = {};

// Rate limiting для Telegram
let lastTelegramSendTime = 0;
const TELEGRAM_MIN_INTERVAL = 500; // мс

// Флаг graceful shutdown
let shuttingDown = false;

// ---------- HTML-экранирование ----------
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------- Подключение к MongoDB ----------
async function connectToMongo() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db();
  tokensCollection = db.collection('tokens');
  console.log('✅ Подключено к MongoDB');
}

// ---------- Функции работы с БД ----------
async function getAllTokens() {
  return await tokensCollection.find({}).toArray();
}
async function getTokenByAddress(address) {
  return await tokensCollection.findOne({ address: address.toLowerCase() });
}
async function tokenExists(address) {
  return await getTokenByAddress(address);
}
async function addToken(tokenData) {
  await tokensCollection.insertOne({
    ...tokenData,
    address: tokenData.address.toLowerCase(),
    lastAlertPrice: null,
  });
}
async function removeTokenByAddress(address) {
  await tokensCollection.deleteOne({ address: address.toLowerCase() });
}
async function updateTokenAlert(address, newPercent) {
  await tokensCollection.updateOne(
    { address: address.toLowerCase() },
    { $set: { changeAlert: newPercent } }
  );
}
async function updateAllAlerts(newPercent) {
  await tokensCollection.updateMany({}, { $set: { changeAlert: newPercent } });
}
async function updateLastAlertPrice(address, price) {
  await tokensCollection.updateOne(
    { address: address.toLowerCase() },
    { $set: { lastAlertPrice: price } }
  );
}
async function resetAllAnchors() {
  await tokensCollection.updateMany({}, { $set: { lastAlertPrice: null } });
}

// ---------- Отправка сообщений с rate limiting и retry ----------
async function sendTelegram(msg) {
  let retries = 3;
  while (retries > 0) {
    try {
      // Соблюдаем минимальный интервал между отправками
      const now = Date.now();
      const wait = Math.max(0, TELEGRAM_MIN_INTERVAL - (now - lastTelegramSendTime));
      if (wait > 0) await new Promise(r => setTimeout(r, wait));

      const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: msg,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
      lastTelegramSendTime = Date.now();

      const data = await res.json();
      if (data.ok) {
        console.log(`✅ Message sent`);
        return; // успех
      } else {
        console.error(`❌ Telegram API error (retries left: ${retries - 1}):`, data);
        retries--;
        if (retries > 0) {
          // exponential backoff: 1с, 2с, 4с
          await new Promise(r => setTimeout(r, (4 - retries) * 1000));
        }
      }
    } catch (e) {
      console.error(`Send error (retries left: ${retries - 1}):`, e);
      retries--;
      if (retries > 0) {
        await new Promise(r => setTimeout(r, (4 - retries) * 1000));
      }
    }
  }
  console.error('❌ Failed to send message after retries');
}

// ---------- Одиночный запрос к DexScreener для верификации адреса (при добавлении) ----------
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

// ---------- Пакетный запрос цен для группы адресов (одна сеть) с exponential backoff при 429 ----------
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

// ---------- Обработка сообщений (полная копия без изменений) ----------
async function handleMessage(msg) {
  const text = msg.text?.trim();
  if (!text) return;
  const chatId = msg.chat.id.toString();
  if (chatId !== CHAT_ID) return;

  if (text === '/start' || text === '/help') {
    userState = null; pendingData = {};
    await sendTelegram(
      '<b>📖 Команды бота:</b>\n\n' +
      '/add — добавить токен\n' +
      '/remove — удалить токен (выбор из списка, подтверждение)\n' +
      '/list — показать список отслеживаемых токенов\n' +
      '/change — изменить процент для одного токена\n' +
      '/change_all — установить одинаковый процент для всех\n' +
      '/reset_anchors — сбросить якорные цены\n' +
      '/cancel — отменить текущее действие\n' +
      '/help — эта справка'
    );
    return;
  }
  if (text === '/cancel') { userState = null; pendingData = {}; await sendTelegram('🚫 Текущее действие отменено.'); return; }
  if (text === '/reset_anchors') { await resetAllAnchors(); needRestart = true; await sendTelegram('🔁 Якорные цены сброшены. Цикл будет перезапущен.'); return; }

  // Состояния
  if (userState === 'awaiting_remove_select') {
    const num = parseInt(text);
    const tokens = await getAllTokens();
    if (isNaN(num) || num < 1 || num > tokens.length) { await sendTelegram('❌ Введите правильный номер токена из списка или /cancel для отмены.'); return; }
    const selected = tokens[num - 1];
    pendingData.removeToken = selected;
    userState = 'awaiting_remove_confirm';
    await sendTelegram(`Вы выбрали <b>${escapeHtml(selected.name.toUpperCase())}</b> (${escapeHtml(selected.chain)})\nАдрес: <code>${escapeHtml(selected.address)}</code>\n\nУдалить этот токен? Напишите <b>yes</b> для подтверждения или <b>no</b> / /cancel для отмены.`);
    return;
  }
  if (userState === 'awaiting_remove_confirm') {
    if (text.toLowerCase() === 'yes') {
      const token = pendingData.removeToken;
      await removeTokenByAddress(token.address);
      needRestart = true;
      await sendTelegram(`✅ Токен <b>${escapeHtml(token.name.toUpperCase())}</b> удалён из отслеживания.`);
    } else {
      await sendTelegram('❌ Удаление отменено.');
    }
    userState = null; pendingData = {}; return;
  }
  if (userState === 'awaiting_change_select') {
    const num = parseInt(text);
    const tokens = await getAllTokens();
    if (isNaN(num) || num < 1 || num > tokens.length) { await sendTelegram('❌ Введите правильный номер токена из списка или /cancel для отмены.'); return; }
    pendingData.changeToken = tokens[num - 1];
    userState = 'awaiting_change_percent';
    await sendTelegram(`Токен <b>${escapeHtml(pendingData.changeToken.name.toUpperCase())}</b>, текущий порог: ${pendingData.changeToken.changeAlert}%\nВведите новый процент (число от 1 до 100):`);
    return;
  }
  if (userState === 'awaiting_change_percent') {
    const percent = parseFloat(text);
    if (isNaN(percent) || percent <= 0 || percent > 100) { await sendTelegram('❌ Некорректный процент. Введите число от 1 до 100 или /cancel.'); return; }
    const token = pendingData.changeToken;
    await updateTokenAlert(token.address, percent);
    needRestart = true;
    await sendTelegram(`🔧 Порог для <b>${escapeHtml(token.name.toUpperCase())}</b> изменён на <b>${percent}%</b>`);
    userState = null; pendingData = {}; return;
  }
  if (userState === 'awaiting_changeall_percent') {
    const percent = parseFloat(text);
    if (isNaN(percent) || percent <= 0 || percent > 100) { await sendTelegram('❌ Некорректный процент. Введите число от 1 до 100 или /cancel.'); return; }
    await updateAllAlerts(percent);
    needRestart = true;
    const count = (await getAllTokens()).length;
    await sendTelegram(`🔧 Процент для всех ${count} токенов изменён на <b>${percent}%</b>`);
    userState = null; pendingData = {}; return;
  }
  if (userState === 'address') {
    const isValidEvm = /^0x[0-9a-fA-F]{40}$/.test(text);
    const isValidSolana = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text);
    if (!isValidEvm && !isValidSolana) {
      await sendTelegram('❌ Некорректный адрес контракта.\n\nEVM-адрес должен быть 0x... (42 символа). Solana-адрес — строка из 32–44 символов.\nПопробуй ещё раз или /cancel.');
      return;
    }
    if (await tokenExists(text)) {
      await sendTelegram('❌ Токен с таким адресом уже отслеживается.');
      userState = null; return;
    }
    await sendTelegram('🔍 Ищу токен на DexScreener...');
    const tokenInfo = await fetchTokenInfo(text);
    if (!tokenInfo) {
      await sendTelegram('❌ Токен не найден на DexScreener. Проверьте адрес или попробуйте позже.');
      return;
    }
    pendingData.newToken = tokenInfo;
    userState = 'percent';
    await sendTelegram(`✅ Токен найден: <b>${escapeHtml(tokenInfo.name.toUpperCase())}</b> (${escapeHtml(tokenInfo.chain)})\n\nВведи процент изменения для алерта (число, например: 10):`);
    return;
  }
  if (userState === 'percent') {
    const percent = parseFloat(text);
    if (isNaN(percent) || percent <= 0 || percent > 100) { await sendTelegram('❌ Некорректный процент. Введите число от 1 до 100 или /cancel.'); return; }
    const token = pendingData.newToken;
    await addToken({ name: token.name, chain: token.chain, address: token.address, changeAlert: percent });
    needRestart = true;
    await sendTelegram(`✅ Токен <b>${escapeHtml(token.name.toUpperCase())}</b> добавлен!\n\nСеть: ${escapeHtml(token.chain)}\nАлерт: <b>${percent}%</b>`);
    userState = null; pendingData = {}; return;
  }

  if (userState) { await sendTelegram('⏳ Вы находитесь в процессе ввода. Завершите действие или введите /cancel для отмены.'); return; }

  if (text === '/add') { userState = 'address'; pendingData = {}; await sendTelegram('Введи адрес контракта токена (0x...):'); return; }
  if (text === '/list') {
    const tokens = await getAllTokens();
    if (tokens.length === 0) { await sendTelegram('📭 Список токенов пуст.'); return; }
    const list = tokens.map((t, i) => `${i + 1}. <b>${escapeHtml(t.name.toUpperCase())}</b> (${escapeHtml(t.chain)})\n   Адрес: <code>${escapeHtml(t.address)}</code>\n   Алерт: ${t.changeAlert}%`).join('\n\n');
    await sendTelegram(`📋 <b>Отслеживаемые токены:</b>\n\n${list}`);
    return;
  }
  if (text === '/remove') {
    const tokens = await getAllTokens();
    if (tokens.length === 0) { await sendTelegram('📭 Список токенов пуст, нечего удалять.'); return; }
    const list = tokens.map((t, i) => `${i + 1}. ${escapeHtml(t.name.toUpperCase())} (${escapeHtml(t.chain)})`).join('\n');
    userState = 'awaiting_remove_select';
    await sendTelegram(`Выбери номер токена для удаления:\n\n${list}\n\nВведи число или /cancel`);
    return;
  }
  if (text === '/change') {
    const tokens = await getAllTokens();
    if (tokens.length === 0) { await sendTelegram('📭 Нет токенов для изменения.'); return; }
    const list = tokens.map((t, i) => `${i + 1}. ${escapeHtml(t.name.toUpperCase())} (${escapeHtml(t.chain)}) — ${t.changeAlert}%`).join('\n');
    userState = 'awaiting_change_select';
    await sendTelegram(`Выбери номер токена для изменения процента:\n\n${list}\n\nВведи число или /cancel`);
    return;
  }
  if (text === '/change_all') { userState = 'awaiting_changeall_percent'; await sendTelegram('Введи процент, который будет установлен для <b>всех</b> токенов (число от 1 до 100):'); return; }

  await sendTelegram('Неизвестная команда. Используйте /help для списка команд.');
}

// ---------- Главный цикл проверки цен (пакетная версия) ----------
async function main() {
  if (isChecking || shuttingDown) {
    console.log("⏳ Предыдущий цикл ещё выполняется или shutting down, пропускаем.");
    return;
  }
  isChecking = true;
  try {
    console.log("\n==================================");
    console.log("🔄 НОВЫЙ ЦИКЛ ПРОВЕРКИ");
    console.log(new Date().toISOString());
    console.log("==================================");

    const tokens = await getAllTokens();
    if (tokens.length === 0) {
      console.log("📭 Нет токенов для проверки");
      return;
    }

    // Строим Map для быстрого доступа, убирая N+1 запросы к БД
    const tokenMap = new Map(tokens.map(t => [t.address.toLowerCase(), t]));

    // Группируем токены по сети
    const byChain = new Map();
    for (const token of tokens) {
      const chain = token.chain || 'ethereum';
      if (!byChain.has(chain)) byChain.set(chain, []);
      byChain.get(chain).push(token);
    }

    for (const [chainId, chainTokens] of byChain) {
      if (needRestart) {
        console.log("⚡ Перезапуск цикла по внешнему запросу");
        break;
      }

      const addresses = chainTokens.map(t => t.address);
      for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
        if (needRestart) break;
        const batchAddresses = addresses.slice(i, i + BATCH_SIZE);
        const batchTokens = chainTokens.slice(i, i + BATCH_SIZE);

        console.log(`🌐 Запрос ${chainId}: ${batchAddresses.length} адресов`);
        const priceData = await fetchBatchPrices(chainId, batchAddresses);

        for (const token of batchTokens) {
          const addr = token.address.toLowerCase();
          const data = priceData[addr];
          if (!data) continue;

          // Используем свежий токен из Map, но если его нет (удалён) — пропускаем
          const freshToken = tokenMap.get(addr);
          if (!freshToken) continue;

          const { price, symbol, url } = data;

          if (freshToken.lastAlertPrice === null || freshToken.lastAlertPrice === undefined) {
            await updateLastAlertPrice(freshToken.address, price);
            console.log(`📌 ${symbol}: якорная цена установлена на $${price}`);
            continue;
          }

          const anchor = freshToken.lastAlertPrice;
          // Защита от деления на ноль
          if (!anchor || anchor === 0) {
            await updateLastAlertPrice(freshToken.address, price);
            console.log(`📌 ${symbol}: сброшен нулевой якорь, установлен на $${price}`);
            continue;
          }

          const changePct = ((price - anchor) / anchor) * 100;
          console.log(`${symbol}: изменение ${changePct.toFixed(2)}% от последнего алерта`);

          if (Math.abs(changePct) >= freshToken.changeAlert) {
            const direction = changePct > 0 ? '🚀' : '🔻';
            const sign = changePct > 0 ? '+' : '';
            const escapedSymbol = escapeHtml(symbol.toUpperCase());
            const escapedUrl = escapeHtml(url);
            const message = `${direction} <a href="${escapedUrl}">${escapedSymbol}</a> ${sign}${changePct.toFixed(2)}%\nЦена: $${formatPrice(price)}`;
            await sendTelegram(message);
            await updateLastAlertPrice(freshToken.address, price);
            console.log(`🔔 ${symbol}: алерт отправлен, якорь обновлён`);
          }
        }

        if (i + BATCH_SIZE < addresses.length) {
          await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
        }
      }
    }
  } catch (err) {
    console.error("❌ FATAL ERROR in main:", err);
    try { await sendTelegram(`❌ BOT ERROR: ${err.message}`); } catch (e) {}
  } finally {
    isChecking = false;
    const shouldRestart = needRestart && !shuttingDown;
    needRestart = false;
    if (shouldRestart) {
      console.log("🔄 Запуск нового цикла после перезапуска");
      setTimeout(main, 1000);
    }
  }
}

function formatPrice(price) {
  if (price < 0.0001) return price.toExponential(3);
  if (price < 1) return price.toPrecision(4);
  return price.toFixed(4);
}

// ---------- Планировщик циклов с интервалом 20 секунд ----------
async function scheduleNext() {
  if (shuttingDown) return;
  await main();
  setTimeout(scheduleNext, CYCLE_INTERVAL_MS);
}

// ---------- Long Polling со встроенным fetch и таймаутом ----------
async function startPolling() {
  let offset = 0;
  console.log("🤖 Long polling started");
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
  console.log("Long polling остановлен (shutdown)");
}

// ---------- Graceful shutdown ----------
function gracefulShutdown() {
  console.log('Получен сигнал завершения, ожидаем завершения текущего цикла...');
  shuttingDown = true;
  // Даём немного времени, чтобы текущий main завершился
  const forceExitTimeout = setTimeout(() => {
    console.error('Принудительный выход по таймауту');
    process.exit(0);
  }, 15000);
  // Проверяем, не завершился ли main
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