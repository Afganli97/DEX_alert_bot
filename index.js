// ==============================
// DEX ALERT BOT с MongoDB (v2.1)
// Исправлена команда /help и улучшена обработка состояний
// ==============================

console.log("==================================");
console.log("DEX BOT STARTED (MongoDB version)");
console.log("TIME:", new Date().toISOString());
console.log("==================================");

const fetch = require('node-fetch');
const express = require('express');
const { MongoClient } = require('mongodb');
const AbortController = global.AbortController;

// ---------- Конфигурация окружения ----------
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 3000;

// ---------- Глобальные переменные ----------
const app = express();
app.use(express.json());

let db;
let tokensCollection;
let isChecking = false;

// Состояния ожидания ввода от пользователя
let userState = null;   // null | 'address' | 'percent' | 'awaiting_remove_select' | ...
let pendingData = {};

// ---------- Подключение к MongoDB ----------
async function connectToMongo() {
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db();
    tokensCollection = db.collection('tokens');
    console.log('✅ Подключено к MongoDB, коллекция tokens готова');
  } catch (err) {
    console.error('❌ Ошибка подключения к MongoDB:', err);
    process.exit(1);
  }
}

// ---------- Функции для работы с токенами в БД ----------
async function getAllTokens() {
  return await tokensCollection.find({}).toArray();
}

async function tokenExists(address) {
  const existing = await tokensCollection.findOne({ address: address.toLowerCase() });
  return !!existing;
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

// ---------- Отправка сообщений в Telegram ----------
async function sendTelegram(message, parseMode = 'Markdown') {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  try {
    console.log("📤 Sending Telegram message...");
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
    });
    const data = await response.json();
    if (!data.ok) {
      console.error("❌ Telegram API error:", data);
    } else {
      console.log("✅ Message sent");
    }
  } catch (err) {
    console.error("❌ TELEGRAM SEND ERROR:", err);
  }
}

// ---------- Запрос данных токена с DexScreener ----------
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
  } catch (err) {
    console.error(`DexScreener lookup error for ${address}:`, err.message);
    return null;
  }
}

// ---------- Обработка webhook (сообщения от пользователя) ----------
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const message = req.body?.message;
    if (!message || !message.text) return;
    const text = message.text.trim();
    const chatId = message.chat.id.toString();
    if (chatId !== CHAT_ID) {
      console.log(`⛔ Неавторизованный доступ от chat ${chatId}`);
      return;
    }

    // ---------- КОМАНДЫ, ДОСТУПНЫЕ ВСЕГДА (сбрасывают состояние) ----------
    if (text === '/start' || text === '/help') {
      userState = null;
      pendingData = {};
      await sendTelegram(
        '📖 *Команды бота:*\n\n' +
        '/add — добавить токен для отслеживания\n' +
        '/remove — удалить токен (выбор из списка, подтверждение)\n' +
        '/list — показать список отслеживаемых токенов\n' +
        '/change — изменить процент для одного токена\n' +
        '/change_all — установить одинаковый процент для всех токенов\n' +
        '/cancel — отменить текущее действие\n' +
        '/help — эта справка'
      );
      return;
    }

    if (text === '/cancel') {
      userState = null;
      pendingData = {};
      await sendTelegram('🚫 Текущее действие отменено.');
      return;
    }

    // ---------- ОБРАБОТКА СОСТОЯНИЙ (если бот ждёт ввода) ----------
    // Состояние: ожидание номера для удаления
    if (userState === 'awaiting_remove_select') {
      const num = parseInt(text);
      const tokens = await getAllTokens();
      if (isNaN(num) || num < 1 || num > tokens.length) {
        await sendTelegram('❌ Введите правильный номер токена из списка или /cancel для отмены.');
        return;
      }
      const selected = tokens[num - 1];
      pendingData.removeToken = selected;
      userState = 'awaiting_remove_confirm';
      await sendTelegram(
        `Вы выбрали *${selected.name.toUpperCase()}* (${selected.chain})\n` +
        `Адрес: \`${selected.address}\`\n\n` +
        `Удалить этот токен? Напишите *yes* для подтверждения или *no* / /cancel для отмены.`
      );
      return;
    }

    // Состояние: подтверждение удаления
    if (userState === 'awaiting_remove_confirm') {
      if (text.toLowerCase() === 'yes') {
        const token = pendingData.removeToken;
        await removeTokenByAddress(token.address);
        await sendTelegram(`✅ Токен *${token.name.toUpperCase()}* удалён из отслеживания.`);
      } else {
        await sendTelegram('❌ Удаление отменено.');
      }
      userState = null;
      pendingData = {};
      return;
    }

    // Состояние: выбор токена для изменения процента
    if (userState === 'awaiting_change_select') {
      const num = parseInt(text);
      const tokens = await getAllTokens();
      if (isNaN(num) || num < 1 || num > tokens.length) {
        await sendTelegram('❌ Введите правильный номер токена из списка или /cancel для отмены.');
        return;
      }
      pendingData.changeToken = tokens[num - 1];
      userState = 'awaiting_change_percent';
      await sendTelegram(
        `Токен *${pendingData.changeToken.name.toUpperCase()}*, текущий порог: ${pendingData.changeToken.changeAlert}%\n` +
        `Введите новый процент (число от 1 до 100):`
      );
      return;
    }

    // Состояние: ввод нового процента для конкретного токена
    if (userState === 'awaiting_change_percent') {
      const percent = parseFloat(text);
      if (isNaN(percent) || percent <= 0 || percent > 100) {
        await sendTelegram('❌ Некорректный процент. Введите число от 1 до 100 или /cancel.');
        return;
      }
      await updateTokenAlert(pendingData.changeToken.address, percent);
      await sendTelegram(
        `🔧 Порог для *${pendingData.changeToken.name.toUpperCase()}* изменён на *${percent}%*`
      );
      userState = null;
      pendingData = {};
      return;
    }

    // Состояние: ввод процента для всех токенов
    if (userState === 'awaiting_changeall_percent') {
      const percent = parseFloat(text);
      if (isNaN(percent) || percent <= 0 || percent > 100) {
        await sendTelegram('❌ Некорректный процент. Введите число от 1 до 100 или /cancel.');
        return;
      }
      await updateAllAlerts(percent);
      const count = (await getAllTokens()).length;
      await sendTelegram(`🔧 Процент для всех ${count} токенов изменён на *${percent}%*`);
      userState = null;
      pendingData = {};
      return;
    }

    // Состояние: ожидание адреса при добавлении
    if (userState === 'address') {
      const isValidEvm = /^0x[0-9a-fA-F]{40}$/.test(text);
      const isValidSolana = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text);
      if (!isValidEvm && !isValidSolana) {
        await sendTelegram(
          '❌ Некорректный адрес контракта.\n\n' +
          'EVM-адрес должен быть 0x... (42 символа). Solana-адрес — строка из 32–44 символов.\n' +
          'Попробуй ещё раз или /cancel.'
        );
        return;
      }

      if (await tokenExists(text)) {
        await sendTelegram('❌ Токен с таким адресом уже отслеживается.');
        userState = null;
        return;
      }

      await sendTelegram('🔍 Ищу токен на DexScreener...');
      const tokenInfo = await fetchTokenInfo(text);
      if (!tokenInfo) {
        await sendTelegram('❌ Токен не найден на DexScreener. Проверьте адрес или попробуйте позже.');
        return;
      }

      pendingData.newToken = tokenInfo;
      userState = 'percent';
      await sendTelegram(
        `✅ Токен найден: *${tokenInfo.name.toUpperCase()}* (${tokenInfo.chain})\n\n` +
        `Введи процент изменения для алерта (число, например: 10):`
      );
      return;
    }

    // Состояние: ожидание процента при добавлении
    if (userState === 'percent') {
      const percent = parseFloat(text);
      if (isNaN(percent) || percent <= 0 || percent > 100) {
        await sendTelegram('❌ Некорректный процент. Введите число от 1 до 100 или /cancel.');
        return;
      }
      const token = pendingData.newToken;
      await addToken({
        name: token.name,
        chain: token.chain,
        address: token.address,
        changeAlert: percent,
      });
      await sendTelegram(
        `✅ Токен *${token.name.toUpperCase()}* добавлен!\n\n` +
        `Сеть: ${token.chain}\n` +
        `Алерт: *${percent}%*`
      );
      userState = null;
      pendingData = {};
      return;
    }

    // ---------- КОМАНДЫ, КОТОРЫЕ РАБОТАЮТ ТОЛЬКО БЕЗ АКТИВНОГО СОСТОЯНИЯ ----------
    if (userState) {
      // Если активно состояние, но команда не /help, /start, /cancel — напоминаем
      await sendTelegram('⏳ Вы находитесь в процессе ввода. Завершите действие или введите /cancel для отмены.');
      return;
    }

    // Команды без состояния
    if (text === '/add') {
      userState = 'address';
      pendingData = {};
      await sendTelegram('Введи адрес контракта токена (0x...):');
      return;
    }

    if (text === '/list') {
      const tokens = await getAllTokens();
      if (tokens.length === 0) {
        await sendTelegram('📭 Список токенов пуст.');
        return;
      }
      const list = tokens.map((t, i) =>
        `${i + 1}. *${t.name.toUpperCase()}* (${t.chain})\n` +
        `   Адрес: \`${t.address}\`\n` +
        `   Алерт: ${t.changeAlert}%`
      ).join('\n\n');
      await sendTelegram(`📋 *Отслеживаемые токены:*\n\n${list}`);
      return;
    }

    if (text === '/remove') {
      const tokens = await getAllTokens();
      if (tokens.length === 0) {
        await sendTelegram('📭 Список токенов пуст, нечего удалять.');
        return;
      }
      const list = tokens.map((t, i) => `${i + 1}. ${t.name.toUpperCase()} (${t.chain})`).join('\n');
      userState = 'awaiting_remove_select';
      await sendTelegram(`Выбери номер токена для удаления:\n\n${list}\n\nВведи число или /cancel`);
      return;
    }

    if (text === '/change') {
      const tokens = await getAllTokens();
      if (tokens.length === 0) {
        await sendTelegram('📭 Нет токенов для изменения.');
        return;
      }
      const list = tokens.map((t, i) => `${i + 1}. ${t.name.toUpperCase()} (${t.chain}) — ${t.changeAlert}%`).join('\n');
      userState = 'awaiting_change_select';
      await sendTelegram(`Выбери номер токена для изменения процента:\n\n${list}\n\nВведи число или /cancel`);
      return;
    }

    if (text === '/change_all') {
      userState = 'awaiting_changeall_percent';
      await sendTelegram('Введи процент, который будет установлен для *всех* токенов (число от 1 до 100):');
      return;
    }

    // Если сообщение не распознано
    await sendTelegram('Неизвестная команда. Используйте /help для списка команд.');

  } catch (err) {
    console.error("❌ Webhook handler error:", err);
  }
});

// ---------- Проверка цены одного токена ----------
async function checkToken(token) {
  try {
    console.log(`\n🔎 Checking ${token.name} (${token.address})`);
    const url = `https://api.dexscreener.com/latest/dex/tokens/${token.address}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      console.log(`${token.name}: HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    const pairs = data?.pairs;
    if (!pairs || pairs.length === 0) {
      console.log(`${token.name}: нет пар`);
      return null;
    }
    const pair = pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    const price = parseFloat(pair.priceUsd || 0);
    if (!price || price <= 0) {
      console.log(`${token.name}: цена невалидна`);
      return null;
    }
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
  if (isChecking) {
    console.log("⏳ Предыдущий цикл ещё выполняется, пропускаем.");
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

    for (const token of tokens) {
      const result = await checkToken(token);
      await new Promise(r => setTimeout(r, 5000)); // пауза между токенами
      if (!result) continue;

      const { price, pair, symbol } = result;

      if (token.lastAlertPrice === null || token.lastAlertPrice === undefined) {
        await updateLastAlertPrice(token.address, price);
        console.log(`📌 ${symbol}: якорная цена установлена на $${price}`);
        continue;
      }

      const anchor = token.lastAlertPrice;
      const changePct = ((price - anchor) / anchor) * 100;
      console.log(`${symbol}: изменение ${changePct.toFixed(2)}% от последнего алерта`);

      if (Math.abs(changePct) >= token.changeAlert) {
        const direction = changePct > 0 ? '🚀' : '🔻';
        const sign = changePct > 0 ? '+' : '';
        const message =
          `${direction} [${symbol.toUpperCase()}](${pair.url || ''}) ${sign}${changePct.toFixed(2)}%\n` +
          `Цена: $${formatPrice(price)}`;
        await sendTelegram(message);
        await updateLastAlertPrice(token.address, price);
        console.log(`🔔 ${symbol}: алерт отправлен, якорь обновлён`);
      }
    }
  } catch (err) {
    console.error("❌ FATAL ERROR in main:", err);
    try {
      await sendTelegram(`❌ BOT ERROR: ${err.message}`);
    } catch (e) {
      console.error("Не удалось отправить сообщение об ошибке");
    }
  } finally {
    isChecking = false;
  }
}

// ---------- Запуск HTTP сервера и регистрация webhook ----------
async function registerWebhook() {
  try {
    const RENDER_URL = process.env.RENDER_URL;
    if (!RENDER_URL) {
      console.log("⚠️ RENDER_URL не задан, webhook не регистрируется");
      return;
    }
    const webhookUrl = `${RENDER_URL}/webhook`;
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl }),
    });
    const data = await res.json();
    if (data.ok) {
      console.log(`✅ Webhook зарегистрирован: ${webhookUrl}`);
    } else {
      console.error("❌ Ошибка регистрации webhook:", data);
    }
  } catch (err) {
    console.error("❌ Webhook registration error:", err);
  }
}

// ---------- Инициализация ----------
async function startBot() {
  await connectToMongo();
  app.listen(PORT, () => {
    console.log(`🌐 HTTP сервер запущен на порту ${PORT}`);
    registerWebhook();
    main(); // первый запуск проверки
    setInterval(main, 180000); // каждые 180 секунд
  });
}

startBot().catch(err => {
  console.error("❌ Критическая ошибка при старте:", err);
  process.exit(1);
});