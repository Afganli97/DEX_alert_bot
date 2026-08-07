/**
 * Parse numeric environment variable with validation and fallback.
 * @param {string} envVar - Environment variable name.
 * @param {number} fallback - Default value if parsing fails or is invalid.
 * @param {number} min - Minimum allowed value (inclusive). Defaults to 0.
 * @returns {number} Parsed integer value or fallback.
 */
function num(envVar, fallback, min = 0) {
  const v = parseInt(process.env[envVar], 10);
  if (!Number.isFinite(v) || v < min) return fallback;
  return v;
}

module.exports = {
  dexPrice: {
    intervalMs: num('DEX_CYCLE_INTERVAL_MS', 20000, 1),
    batchSize: num('DEX_BATCH_SIZE', 30, 1),
    batchDelayMs: num('DEX_BATCH_DELAY_MS', 1000, 0),
  },
  telegram: {
    queueDelayMs: num('TG_QUEUE_DELAY_MS', 35, 1),
  },
};