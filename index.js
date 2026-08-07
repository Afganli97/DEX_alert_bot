// ==============================
// DEX ALERT BOT (Multi-user version)
// ==============================
require('dotenv').config();
const { connectToMongo, closeMongo } = require('./lib/db');
const { initUsers, ensureUser, isAdmin, markUserBlocked } = require('./lib/users');
const { startScheduler } = require('./scheduler');
const { startWebhookServer } = require('./webhookServer');

// Telegram polling will be started in this file

let db;
let usersCollection;
let alertsCollection;
let client;
let ctx;

// Initialize modules after DB connection
async function initializeModules() {
  usersCollection = db.collection('users');
  alertsCollection = db.collection('alerts');

  // Initialize users module
  initUsers(usersCollection);

  // Initialize Telegram queue
  const { setUsersCollection } = require('./lib/telegram');
  setUsersCollection(usersCollection);

  // Initialize alert checker
  const dexPriceChecker = require('./checkers/dexPriceChecker');
  dexPriceChecker.initCollections(alertsCollection, usersCollection);

  // Initialize command handlers
  const commandHandlers = require('./handlers/commands');
  commandHandlers.initCollections(alertsCollection, usersCollection);

  console.log('✅ Все модули инициализированы');
}

// Start Telegram long polling
async function startPolling() {
  const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
  
  // Валидация формата токена бота (идентификатор:строка)
  const tokenPattern = /^\d{9,10}:\w{35,}$/;
  if (!tokenPattern.test(TELEGRAM_TOKEN.trim())) {
    throw new Error('TELEGRAM_TOKEN has invalid format');
  }

  const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN.trim()}`;
  let offset = 0;

  console.log('🚀 Запуск long polling...');

  while (!global.shuttingDown) {
    try {
      const res = await fetch(`${TELEGRAM_API}/getUpdates?offset=${offset}&timeout=30`, {
        signal: AbortSignal.timeout(30000),
      });
      
      if (!res.ok) {
        console.error(`HTTP error: ${res.status}`);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      
      const data = await res.json();

      if (!data.ok) {
        console.error('Telegram getUpdates error:', data);
        await new Promise(r => setTimeout(r, 5000)); // don't hammer API without delay
        continue;
      }

      if (data.result) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          if (update.message) {
            // Handle message using the initialized command handlers
            const commandHandlers = require('./handlers/commands');
            await commandHandlers.handleMessage(update.message);
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        console.error('Timeout в polling');
      } else {
        console.error('Ошибка в long polling:', err);
      }
      await new Promise(r => setTimeout(r, 5000)); // Wait 5 seconds before retrying
    }
  }
}

// Graceful shutdown
async function shutdown() {
  console.log('🛑 Получен сигнал остановки...');
  global.shuttingDown = true;

  // Wait for the current check cycle to finish before closing DB
  while (ctx.isChecking) {
    await new Promise(r => setTimeout(r, 500));
  }

  await closeMongo();
  console.log('✅ Остановка завершена');
  process.exit(0);
}

async function main() {
  try {
    // Connect to MongoDB
    const { db: dbObj, client: clientObj } = await connectToMongo(process.env.MONGO_URI);
    db = dbObj;
    client = clientObj;

    // Initialize modules
    await initializeModules();

    // Set up global shuttingDown flag for scheduler and polling
    global.shuttingDown = false;

    // Start scheduler — ctx.shuttingDown is a getter that mirrors global.shuttingDown
    ctx = {
      get shuttingDown() { return global.shuttingDown; },
      isChecking: false,
    };
    startScheduler(ctx);

    // Start webhook server (replaces long polling)
    startWebhookServer();
    // Register webhook with Telegram (once per start)
    await setTelegramWebhook();
  const token = process.env.TELEGRAM_TOKEN;
  const webhookUrl = process.env.WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('WEBHOOK_URL not set in .env – skipping webhook registration');
    return;
  }
  const api = `https://api.telegram.org/bot${token}/setWebhook`;
  try {
    const res = await fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error('❌ Ошибка регистрации вебхука:', data);
    } else {
      console.log('✅ Вебхук успешно установлен:', data.result);
    }
  } catch (err) {
    console.error('❌ Ошибка при попытке установить вебхук:', err);
  }
}


    // Handle shutdown signals
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    console.log('🤖 Бот запущен и готов к работе');
  } catch (err) {
    console.error('❌ Ошибка при запуске бота:', err);
    await closeMongo();
    process.exit(1);
  }
}

main();