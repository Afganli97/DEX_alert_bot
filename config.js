function num(envVar, fallback) {
  const v = parseInt(process.env[envVar], 10);
  return Number.isFinite(v) ? v : fallback;
}

module.exports = {
  dexPrice: {
    intervalMs: num('DEX_CYCLE_INTERVAL_MS', 20000),
    batchSize: num('DEX_BATCH_SIZE', 30),
    batchDelayMs: num('DEX_BATCH_DELAY_MS', 1000),
  },
  telegram: {
    queueDelayMs: num('TG_QUEUE_DELAY_MS', 35),
  },
};