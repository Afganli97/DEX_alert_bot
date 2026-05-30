// ==============================
// DEX ALERT BOT (Polling версия со встроенным fetch)
// ==============================
require('dotenv').config();
const { MongoClient } = require('mongodb');

// ---------- Конфигурация ----------
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const MONGO_URI = process.env.MONGO_URI;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// ---------- Глобальные переменные ----------
let db;
let tokensCollection;
let isChecking = false;
let needRestart = false;

let userState = null;
let pendingData = {};

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
  await tokensCollection.insertOne({ ...tokenData, address: tokenData.address.toLowerCase(), lastAlertPrice: null });
}
async function removeTokenByAddress(address) {
  await tokensCollection.deleteOne({ address: address.toLowerCase() });
}
async function updateTokenAlert(address, newPercent) {
  await tokensCollection.updateOne({ address: address.toLowerCase() }, { $set: { changeAlert: newPercent } });
}
async function updateAllAlerts(newPercent) {
  await tokensCollection.updateMany({}, { $set: { changeAlert: newPercent } });
}
async function updateLastAlertPrice(address, price) {
  await tokensCollection.updateOne({ address: address.toLowerCase() }, { $set: { lastAlertPrice: price } });
}
async function resetAllAnchors() {
  await tokensCollection.updateMany({}, { $set: { lastAlertPrice: null } });
}

// ---------- Отправка сообщений (используем глобальный fetch) ----------
async function sendTelegram(msg) {
  try {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
  } catch (e) { console.error('Send error:', e); }
}

// ---------- DexScreener ----------
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
    return { name: (bestPair.baseToken?.symbol || 'unknown').toLowerCase(), chain: bestPair.chainId || 'unknown', address };
  } catch (e) { return null; }
}

// ---------- Обработка сообщений ----------
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

  if (userState === 'awaiting_remove_select') {
    const num = parseInt(text);
    const tokens = await getAllTokens();
    if (isNaN(num) || num < 1 || num > tokens.length) { await sendTelegram('❌ Введите правильный номер токена из списка или /cancel для отмены.'); return; }
    const selected = tokens[num - 1];
    pendingData.removeToken = selected;
    userState = 'awaiting_remove_confirm';
    await sendTelegram(`Вы выбрали <b>${selected.name.toUpperCase()}</b> (${selected.chain})\nАдрес: <code>${selected.address}</code>\n\nУдалить этот токен? Напишите <b>yes</b> для подтверждения или <b>no</b> / /cancel для отмены.`);
    return;
  }
  if (userState === 'awaiting_remove_confirm') {
    if (text.toLowerCase() === 'yes') {
      const token = pendingData.removeToken;
      await removeTokenByAddress(token.address);
      needRestart = true;
      await sendTelegram(`✅ Токен <b>${token.name.toUpperCase()}</b> удалён из отслеживания.`);
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
    await sendTelegram(`Токен <b>${pendingData.changeToken.name.toUpperCase()}</b>, текущий порог: ${pendingData.changeToken.changeAlert}%\nВведите новый процент (число от 1 до 100):`);
    return;
  }
  if (userState === 'awaiting_change_percent') {
    const percent = parseFloat(text);
    if (isNaN(percent) || percent <= 0 || percent > 100) { await sendTelegram('❌ Некорректный процент. Введите число от 1 до 100 или /cancel.'); return; }
    const token = pendingData.changeToken;
    await updateTokenAlert(token.address, percent);
    needRestart = true;
    await sendTelegram(`🔧 Порог для <b>${token.name.toUpperCase()}</b> изменён на <b>${percent}%</b>`);
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
    await sendTelegram(`✅ Токен найден: <b>${tokenInfo.name.toUpperCase()}</b> (${tokenInfo.chain})\n\nВведи процент изменения для алерта (число, например: 10):`);
    return;
  }
  if (userState === 'percent') {
    const percent = parseFloat(text);
    if (isNaN(percent) || percent <= 0 || percent > 100) { await sendTelegram('❌ Некорректный процент. Введите число от 1 до 100 или /cancel.'); return; }
    const token = pendingData.newToken;
    await addToken({ name: token.name, chain: token.chain, address: token.address, changeAlert: percent });
    needRestart = true;
    await sendTelegram(`✅ Токен <b>${token.name.toUpperCase()}</b> добавлен!\n\nСеть: ${token.chain}\nАлерт: <b>${percent}%</b>`);
    userState = null; pendingData = {}; return;
  }

  if (userState) { await sendTelegram('⏳ Вы находитесь в процессе ввода. Завершите действие или введите /cancel для отмены.'); return; }

  if (text === '/add') { userState = 'address'; pendingData = {}; await sendTelegram('Введи адрес контракта токена (0x...):'); return; }
  if (text === '/list') {
    const tokens = await getAllTokens();
    if (tokens.length === 0) { await sendTelegram('📭 Список токенов пуст.'); return; }
    const list = tokens.map((t, i) => `${i + 1}. <b>${t.name.toUpperCase()}</b> (${t.chain})\n   Адрес: <code>${t.address}</code>\n   Алерт: ${t.changeAlert}%`).join('\n\n');
    await sendTelegram(`📋 <b>Отслеживаемые токены:</b>\n\n${list}`);
    return;
  }
  if (text === '/remove') {
    const tokens = await getAllTokens();
    if (tokens.length === 0) { await sendTelegram('📭 Список токенов пуст, нечего удалять.'); return; }
    const list = tokens.map((t, i) => `${i + 1}. ${t.name.toUpperCase()} (${t.chain})`).join('\n');
    userState = 'awaiting_remove_select';
    await sendTelegram(`Выбери номер токена для удаления:\n\n${list}\n\nВведи число или /cancel`);
    return;
  }
  if (text === '/change') {
    const tokens = await getAllTokens();
    if (tokens.length === 0) { await sendTelegram('📭 Нет токенов для изменения.'); return; }
    const list = tokens.map((t, i) => `${i + 1}. ${t.name.toUpperCase()} (${t.chain}) — ${t.changeAlert}%`).join('\n');
    userState = 'awaiting_change_select';
    await sendTelegram(`Выбери номер токена для изменения процента:\n\n${list}\n\nВведи число или /cancel`);
    return;
  }
  if (text === '/change_all') { userState = 'awaiting_changeall_percent'; await sendTelegram('Введи процент, который будет установлен для <b>всех</b> токенов (число от 1 до 100):'); return; }

  await sendTelegram('Неизвестная команда. Используйте /help для списка команд.');
}

// ---------- Проверка цены одного токена ----------
async function checkToken(token) {
  try {
    console.log(`\n🔎 Checking ${token.name} (${token.address})`);
    const url = `https://api.dexscreener.com/latest/dex/tokens/${token.address}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) { console.log(`${token.name}: HTTP ${res.status}`); return null; }
    const data = await res.json();
    const pairs = data?.pairs;
    if (!pairs || pairs.length === 0) { console.log(`${token.name}: нет пар`); return null; }
    const pair = pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    const price = parseFloat(pair.priceUsd || 0);
    if (!price || price <= 0) { console.log(`${token.name}: цена невалидна`); return null; }
    console.log(`${token.name}: $${price}`);
    return { price, pair, symbol: pair.baseToken?.symbol || token.name };
  } catch (err) {
    console.error(`❌ ERROR checking ${token.name}:`, err.message);
    return null;
  }
}

function formatPrice(price) {
  if (price < 0.0001) return price.toExponential(3);
  if (price < 1) return price.toPrecision(4);
  return price.toFixed(4);
}

// ---------- Главный цикл проверки цен ----------
async function main() {
  if (isChecking) { console.log("⏳ Предыдущий цикл ещё выполняется, пропускаем."); return; }
  isChecking = true;
  try {
    console.log("\n==================================");
    console.log("🔄 НОВЫЙ ЦИКЛ ПРОВЕРКИ");
    console.log(new Date().toISOString());
    console.log("==================================");
    const tokens = await getAllTokens();
    if (tokens.length === 0) { console.log("📭 Нет токенов для проверки"); return; }
    for (const token of tokens) {
      if (needRestart) { console.log("⚡ Перезапуск цикла по внешнему запросу"); break; }
      const result = await checkToken(token);
      await new Promise(r => setTimeout(r, 5000));
      if (!result) continue;
      const freshToken = await getTokenByAddress(token.address);
      if (!freshToken) continue;
      const { price, pair, symbol } = result;
      if (freshToken.lastAlertPrice === null || freshToken.lastAlertPrice === undefined) {
        await updateLastAlertPrice(freshToken.address, price);
        console.log(`📌 ${symbol}: якорная цена установлена на $${price}`);
        continue;
      }
      const anchor = freshToken.lastAlertPrice;
      const changePct = ((price - anchor) / anchor) * 100;
      console.log(`${symbol}: изменение ${changePct.toFixed(2)}% от последнего алерта`);
      if (Math.abs(changePct) >= freshToken.changeAlert) {
        const direction = changePct > 0 ? '🚀' : '🔻';
        const sign = changePct > 0 ? '+' : '';
        const dexUrl = pair.url || '';
        const message = `${direction} <a href="${dexUrl}">${symbol.toUpperCase()}</a> ${sign}${changePct.toFixed(2)}%\nЦена: $${formatPrice(price)}`;
        await sendTelegram(message);
        await updateLastAlertPrice(freshToken.address, price);
        console.log(`🔔 ${symbol}: алерт отправлен, якорь обновлён`);
      }
    }
  } catch (err) {
    console.error("❌ FATAL ERROR in main:", err);
    try { await sendTelegram(`❌ BOT ERROR: ${err.message}`); } catch (e) {}
  } finally {
    isChecking = false;
    const shouldRestart = needRestart;
    needRestart = false;
    if (shouldRestart) {
      console.log("🔄 Запуск нового цикла после перезапуска");
      setTimeout(main, 1000);
    }
  }
}

// ---------- Планировщик циклов ----------
async function scheduleNext() {
  await main();
  setTimeout(scheduleNext, 180000);
}

// ---------- Long Polling со встроенным fetch и таймаутом ----------
async function startPolling() {
  let offset = 0;
  console.log("🤖 Long polling started");
  while (true) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // обрываем fetch через 15 секунд, если нет ответа
      const res = await fetch(`${TELEGRAM_API}/getUpdates?offset=${offset}&timeout=10`, { signal: controller.signal });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (data.ok && data.result.length > 0) {
        for (const upd of data.result) {
          offset = upd.update_id + 1;
          if (upd.message) await handleMessage(upd.message);
        }
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        // Таймаут polling — это нормально, продолжаем
        console.log('Polling timeout, restarting...');
      } else {
        console.error('Polling error:', e);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }
}

// ---------- Старт ----------
(async () => {
  await connectToMongo();
  scheduleNext();
  startPolling();
})();