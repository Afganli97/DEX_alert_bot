// ==============================
// Token Info Fetch Operations
// ==============================

let alertsCollection = null;
const { fetchWithRetry } = require('../lib/fetchWithRetry');
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
  const res = await fetchWithRetry(url);

  if (!res.ok) {
    console.error(`fetchTokenInfo: HTTP ${res.status}`);
    return null;
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
}

module.exports = {
  initCollections,
  fetchTokenInfo
};