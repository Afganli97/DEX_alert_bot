// ==============================
// DEX ALERT BOT MONITOR (standalone monitor)
// ==============================
// This is a standalone entry point that can be scheduled
// to run the monitoring cycle on demand (e.g., via cron/heartbeat).
// It connects to DB, runs the monitoring cycle via the checker, and exits.
// ==============================

require('dotenv').config();
const { connectToMongo, closeMongo, getDb } = require('./lib/db');
const dexPriceChecker = require('./checkers/dexPriceChecker');

async function main() {
  let db;
  try {
    // Connect to MongoDB
    const dbObj = await connectToMongo(process.env.MONGO_URI);
    db = dbObj.db;

    // Initialize collections in the checker
    dexPriceChecker.initCollections(dbObj.alerts, dbObj.users);

    // Create context object for the checker
    const ctx = {
      shuttingDown: false,
      isChecking: false,
    };

    // Run one cycle
    await dexPriceChecker.runCycle(ctx);

    console.log('✅ Monitor cycle completed');
  } catch (err) {
    console.error('❌ Error in monitor.js:', err);
    process.exit(1);
  } finally {
    // Close database connection
    if (db) {
      await closeMongo();
    }
    process.exit(0);
  }
}

main();