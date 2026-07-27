// ==============================
// Migration script: watchlist -> alerts
// Run once: node migrate.js
// ==============================

require('dotenv').config();
const { MongoClient } = require('mongodb');

async function migrate() {
  const client = new MongoClient(process.env.MONGO_URI);
  try {
    await client.connect();
    const db = client.db();
    const watchlist = db.collection('watchlist');
    const alerts = db.collection('alerts');

    console.log('🔄 Starting migration from watchlist to alerts...');

    const items = await watchlist.find({}).toArray();
    console.log(`📊 Found ${items.length} records in watchlist`);

    for (const item of items) {
      await alerts.insertOne({
        ownerId: item.ownerId,
        source: 'dex',
        target: { chain: item.chain, address: item.address },
        condition: {
          kind: 'percent_change',
          changePercent: item.changeAlert,
          baselinePrice: item.lastAlertPrice,
        },
        repeat: 'always',
        status: 'active',
        createdAt: item.createdAt || new Date(),
      });
    }

    console.log(`✅ Migrated ${items.length} records from watchlist to alerts`);
    console.log('⚠️  The watchlist collection is kept as backup. You may drop it manually after verification.');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

migrate();