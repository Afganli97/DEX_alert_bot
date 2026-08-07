// ==============================
// Token Info Fetch Operations
// ==============================

let alertsCollection = null;
let usersCollection = null;

/**
 * Initialize collections
 * @param {Object} alerts - Alerts collection
 * @param {Object} users - Users collection
 */
function initCollections(alerts, users) {
  alertsCollection = alerts;
  usersCollection = users;
}

// ============ Token Info Fetch ============

/**
 * Fetch token info from DexScreener
 * @param {string} address - Token address
 * @returns {Promise<Object|null>} Token info
 */
async function fetchTokenInfo(address) {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${address}`;
  const maxRetries = 3;
  let delay = 2000;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (res.status === 429) {
        console.log(`⚠️ fetchTokenInfo: 429 Too Many Requests, попытка ${attempt + 1}/${maxRetries}, ждём ${delay / 1000}с...`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      const pairs = data?.pairs;
      if (!pairs || pairs.length === 0) return null;
      const bestPair = pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
      return {
        name: (bestPair.baseToken?.symbol || 'unknown').toLowerCase(),
        chain: bestPair.chainId || 'unknown',
        address: address,
      };
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log(`⏱️ fetchTokenInfo: Timeout, попытка ${attempt + 1}/${maxRetries}`);
      } else {
        console.error(`fetchTokenInfo error (attempt ${attempt + 1}/${maxRetries}):`, err.message);
      }
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      }
    }
  }
  console.error(`❌ fetchTokenInfo: не удалось получить данные после ${maxRetries} попыток`);
  return null;
}

module.exports = {
  initCollections,
  fetchTokenInfo
};