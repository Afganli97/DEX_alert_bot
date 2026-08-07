// ==============================
// Scheduler - starts and manages all checkers
// ==============================

const config = require('./config');
const dexPriceChecker = require('./checkers/dexPriceChecker');

// Checkers configuration with metadata
const checkers = [
  {
    module: dexPriceChecker,
    type: dexPriceChecker.type,
    intervalMs: config.dexPrice.intervalMs,
  },
];

/**
 * Start all checkers with their configured intervals
 * @param {Object} ctx - Context object with shuttingDown flag
 */
function startScheduler(ctx) {
  for (const checker of checkers) {
    const loop = async () => {
      if (!ctx.shuttingDown) {
        try {
          await checker.module.runCycle(ctx);
        } catch (e) {
          console.error(`${checker.type} checker error:`, e);
        }
      }
      setTimeout(loop, checker.intervalMs);
    };

    // Start immediately, then repeat
    loop();

    console.log(`📅 Запущен ${checker.type} checker с интервалом ${checker.intervalMs}мс`);
  }
}

module.exports = {
  startScheduler,
  checkers,
};