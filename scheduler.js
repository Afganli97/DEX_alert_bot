// ==============================
// Scheduler - starts and manages all checkers
// ==============================

const config = require('../config');
const dexPriceChecker = require('../checkers/dexPriceChecker');

const checkers = [dexPriceChecker];

/**
 * Start all checkers with their configured intervals
 * @param {Object} ctx - Context object with shuttingDown flag
 */
function startScheduler(ctx) {
  for (const checker of checkers) {
    const loop = async () => {
      if (!ctx.shuttingDown) {
        try {
          await checker.runCycle(ctx);
        } catch (e) {
          console.error(`${checker.type} error:`, e);
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