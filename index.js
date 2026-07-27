// ==============================
// DEX ALERT BOT (Multi-user version)
// ==============================
require('dotenv').config();
const { MongoClient } = require('mongodb');
const { connectToMongo, closeMongo } = require('./lib/db');
const { initUsers, ensureUser, isAdmin, markUserBlocked } = require('./lib/users');
const { initCollections: initAlertsCollection } = require('./checkers/dexPriceChecker');
const { initCollections: initCommandHandlers } = require('./handlers/commands');
const { startScheduler } = require('./scheduler');

// Telegram polling will be started in this file

let db;
let usersCollection;
let alertsCollection;
let client;

// Initialize modules after DB connection
async function initializeModules() {
  usersCollection = db.collection('users');
  alertsCollection = db.collection('alerts');

  // Initialize users module
  initUsers(usersCollection);

  // Initialize alert checker
  const dexPriceChecker = require('./checkers/dexPriceChecker');
  dexPriceChecker.initCollections(alertsCollection, usersCollection);

  // Initialize command handlers
  const commandHandlers = require('./handlers/commands');
  commandHandlers.initCollections(alertsCollection, usersCollection);
}

// Start Telegram long polling
async function startPolling() {
  const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
  const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
  let offset = 0;

  console.log('🚀 Запуск long polling...');

  while (!global.shuttingDown) {
    try {
      const res = await fetch(`${TELEGRAM_API}/getUpdates?offset=${offset}&timeout=30`);
      const data = await res.json();

      if (data.ok && data.result) {
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
      console.error('Ошибка в long polling:', err);
      await new Promise(r => setTimeout(r, 5000)); // Wait 5 seconds before retrying
    }
  }
}

// Graceful shutdown
async function shutdown() {
  console.log('🛑 Получен сигнал остановки...');
  global.shuttingDown = true;
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

    // Start scheduler
    const ctx = {
      shuttingDown: false,
      isChecking: false,
    };
    startScheduler(ctx);

    // Start polling
    startPolling().catch(console.error);

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