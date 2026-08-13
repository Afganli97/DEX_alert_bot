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

/**
 * Default configuration values for DEX price checker.
 * Can be overridden via environment variables.
 */
const DEFAULTS = {
  DEX_CYCLE_INTERVAL_MS: 20000,
  DEX_BATCH_SIZE: 30,
  DEX_BATCH_DELAY_MS: 1000,
  TG_QUEUE_DELAY_MS: 35,
};

module.exports = {
  DEFAULTS,
  dexPrice: {
    intervalMs: num('DEX_CYCLE_INTERVAL_MS', DEFAULTS.DEX_CYCLE_INTERVAL_MS, 1),
    batchSize: num('DEX_BATCH_SIZE', DEFAULTS.DEX_BATCH_SIZE, 1),
    batchDelayMs: num('DEX_BATCH_DELAY_MS', DEFAULTS.DEX_BATCH_DELAY_MS, 0),
  },
  telegram: {
    queueDelayMs: num('TG_QUEUE_DELAY_MS', DEFAULTS.TG_QUEUE_DELAY_MS, 1),
  },
  num,
};