// ==============================
// Migration script: tokens (legacy single-user) -> alerts (multi-user)
// Run once: node migrate.js
// ==============================

require('dotenv').config();
const { MongoClient } = require('mongodb');

const requiredEnv = ['MONGO_URI', 'LEGACY_OWNER_CHAT_ID'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`❌ Отсутствует обязательная переменная окружения: ${key}`);
    process.exit(1);
  }
}

const LEGACY_OWNER_CHAT_ID = process.env.LEGACY_OWNER_CHAT_ID;

async function migrate() {
  const client = new MongoClient(process.env.MONGO_URI);
  let exitCode = 0;

  try {
    await client.connect();
    const db = client.db();
    const legacyTokens = db.collection('tokens');
    const alerts = db.collection('alerts');

    await alerts.createIndex({ ownerId: 1, source: 1, 'target.address': 1 }, { unique: true });

    console.log('🔄 Starting migration from tokens (legacy) to alerts...');
    console.log(`👤 All migrated records will be assigned to ownerId: ${LEGACY_OWNER_CHAT_ID}`);

    const items = await legacyTokens.find({}).toArray();
    console.log(`📊 Found ${items.length} records in tokens`);

    let migrated = 0, skipped = 0, failed = 0;

    for (const item of items) {
      if (!item.chain || !item.address) {
        console.warn(`⚠️ Skipping malformed record ${item._id}: missing chain/address`);
        skipped++;
        continue;
      }

      const doc = {
  ownerId: LEGACY_OWNER_CHAT_ID,
  source: 'dex',
  target: {
    chain: item.chain.toLowerCase(),
    address: item.address.toLowerCase(),
  },
  condition: {
    kind: 'percent_change',
    changePercent: item.changeAlert,
    baselinePrice: item.lastAlertPrice ?? null,
  },
  repeat: 'always',
  status: 'active',
  name: item.name || 'unknown',
  createdAt: new Date(),
};

      try {
        await alerts.insertOne(doc);
        migrated++;
      } catch (err) {
        if (err.code === 11000) {
          skipped++; // уже мигрировано ранее, безопасно пропускаем
        } else {
          console.error(`❌ Failed to migrate record ${item._id}:`, err.message);
          failed++;
        }
      }
    }

    const alertsCount = await alerts.countDocuments({ ownerId: LEGACY_OWNER_CHAT_ID, source: 'dex' });
    console.log(`✅ Migrated: ${migrated}, skipped (duplicates/invalid): ${skipped}, failed: ${failed}`);
    console.log(`📊 Verification: tokens has ${items.length} records, alerts for this owner now has ${alertsCount}`);
    console.log('⚠️  The tokens collection is kept as backup. Drop it manually only after verifying alerts data is correct.');

    if (failed > 0) exitCode = 1;
  } catch (err) {
    console.error('❌ Migration failed:', err);
    exitCode = 1;
  } finally {
    await client.close();
    process.exit(exitCode);
  }
}

migrate();
