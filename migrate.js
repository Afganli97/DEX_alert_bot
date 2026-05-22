// migrate.js — одноразовый скрипт для переноса токенов в MongoDB

const { MongoClient } = require('mongodb');
const fs = require('fs');

// Твоя строка подключения (база dex_alert_bot)
const MONGO_URI = 'mongodb+srv://botuser:botuser@cluster0.ylzuhwv.mongodb.net/dex_alert_bot?retryWrites=true&w=majority';

// Загрузка статических токенов (если файла нет — будет пустой массив)
let staticTokens = [];
try {
  staticTokens = require('./tokens');
  console.log(`Загружено статических токенов из tokens.js: ${staticTokens.length}`);
} catch (e) {
  console.log('tokens.js не найден, статические токены пропущены.');
}

// Загрузка динамических токенов
let dynamicTokens = [];
try {
  if (fs.existsSync('tokens_dynamic.json')) {
    dynamicTokens = JSON.parse(fs.readFileSync('tokens_dynamic.json', 'utf8'));
    console.log(`Загружено динамических токенов: ${dynamicTokens.length}`);
  } else {
    console.log('tokens_dynamic.json не найден.');
  }
} catch (e) {
  console.error('Ошибка чтения tokens_dynamic.json:', e.message);
}

const allTokens = [...staticTokens, ...dynamicTokens];

// Приводим к единому формату для MongoDB:
// name, chain, address, changeAlert, lastAlertPrice: null
const tokensToInsert = allTokens.map(t => ({
  name: t.name.toLowerCase(),
  chain: t.chain,
  address: t.address.toLowerCase(),
  changeAlert: t.changeAlert,
  lastAlertPrice: null
}));

async function migrate() {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db(); // база указана в URI
    const collection = db.collection('tokens');

    // Очистим коллекцию перед вставкой (опционально, чтобы избежать дубликатов)
    // Если хочешь сохранить уже добавленные через бота токены — закомментируй или используй insertMany с ordered:false
    await collection.deleteMany({});
    console.log('Коллекция tokens очищена.');

    if (tokensToInsert.length > 0) {
      const result = await collection.insertMany(tokensToInsert);
      console.log(`✅ Перенесено ${result.insertedCount} токенов.`);
    } else {
      console.log('Нет токенов для переноса.');
    }
  } catch (err) {
    console.error('❌ Ошибка миграции:', err);
  } finally {
    await client.close();
  }
}

migrate();