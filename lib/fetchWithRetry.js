// ==============================
// Shared fetch with retry logic
// ==============================

/**
 * Fetch with exponential backoff retry.
 * @param {string} url - URL to fetch
 * @param {Object} options - Fetch options
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} initialDelayMs - Initial delay in milliseconds
 * @param {number} timeoutMs - Request timeout in milliseconds
 * @returns {Promise<Response>} Fetch response
 */
async function fetchWithRetry(url, options = {}, maxRetries = 3, initialDelayMs = 2000, timeoutMs = 15000) {
  let delay = initialDelayMs;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        return res;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log(`⏱️ Timeout for ${url}, attempt ${attempt + 1}/${maxRetries}`);
      } else {
        console.error(`❌ Fetch error (${url}):`, err.message);
      }
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      }
    }
  }
  // After exhausting retries, return a falsy response similar to a failed fetch
  return { ok: false, status: 0, json: async () => ({}) };
}

module.exports = { fetchWithRetry };
