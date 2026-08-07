// ==============================
// DEX Price Checker - fetches prices from DexScreener and sends alerts
// ==============================

const config = require('../config');
const { evaluate } = require('../conditionEvaluator');
const { escapeHtml, sendTelegram } = require('../lib/telegram');

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

/**
 * Cache for blocked user IDs to avoid repeated DB queries.
 * Structure: { set: Set<chatId>, updatedAt: number }
 */
let blockedUsersCache = { set: new Set(), updatedAt: 0 };
const BLOCKED_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Format price for display
 * @param {number} price - Price value
 * @returns {string} Formatted price
 */
function formatPrice(price) {
  if (price < 0.0001) return price.toExponential(3);
  if (price < 1) return price.toPrecision(4);
  return price.toFixed(4);
}

/**
 * Fetch token prices in batch from DexScreener
 * @param {string} chainId - Chain ID (e.g., 'ethereum')
 * @param {string[]} addresses - Array of token addresses
 * @returns {Promise<Object>} Map of address -> price info
 */
async function fetchBatchPrices(chainId, addresses) {
  const url = `https://api.dexscreener.com/tokens/v1/${chainId}/${addresses.join(',')}`;
  const maxRetries = 3;
  let delay = 2000;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.status === 429) {
        console.log(`⚠️ 429 Too Many Requests, попытка ${attempt + 1}/${maxRetries}, ждём ${delay / 1000}с...`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
        continue;
      }

      if (!res.ok) {
        console.log(`❌ HTTP ${res.status} для ${chainId} батча`);
        return {};
      }

      const data = await res.json();
      const pairs = Array.isArray(data) ? data : (data?.pairs || []);

      const resultMap = {};
      for (const pair of pairs) {
        const addr = pair?.baseToken?.address?.toLowerCase();
        if (!addr) continue;
        const liquidity = parseFloat(pair?.liquidity?.usd || 0);
        const current = resultMap[addr];
        if (!current || liquidity >= current.liquidity) {
          resultMap[addr] = {
            price: parseFloat(pair.priceUsd || 0),
            url: pair.url || '',
            symbol: pair?.baseToken?.symbol || 'UNKNOWN',
            liquidity,
          };
        }
      }
      return resultMap;
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log(`⏱️ Timeout для ${chainId} батча, попытка ${attempt + 1}`);
      } else {
        console.error(`❌ Ошибка пакетного запроса (${chainId}):`, err);
      }
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      }
    }
  }
  console.error(`❌ Не удалось получить данные для ${chainId} после ${maxRetries} попыток, пропущено адресов: ${addresses.length}`);
  return {};
}

/**
 * Get all alerts for DEX source
 * @returns {Promise<Array>} Array of alert documents
 */
async function getDexAlerts() {
  return await alertsCollection.find({ source: 'dex', status: 'active' }).toArray();
}

/**
 * Get set of blocked user IDs with caching.
 * @returns {Promise<Set>} Set of blocked chat IDs
 */
async function getBlockedUsers() {
  const now = Date.now();
  if (now - blockedUsersCache.updatedAt < BLOCKED_CACHE_TTL_MS) {
    return blockedUsersCache.set;
  }

  const set = new Set();
  const cursor = await usersCollection.find({ status: 'blocked' }, { projection: { _id: 1 } });
  await cursor.forEach(doc => set.add(doc._id));

  blockedUsersCache = { set, updatedAt: now };
  return set;
}

/**
 * Update alert's baseline price
 * @param {ObjectId} alertId - Alert document ID
 * @param {number} price - New baseline price
 */
async function updateAlertBaseline(alertId, price) {
  await alertsCollection.updateOne(
    { _id: alertId },
    { $set: { 'condition.baselinePrice': price } }
  );
}

/**
 * Main cycle to check DEX prices and send alerts
 * @param {Object} ctx - Context with shuttingDown flag
 * @returns {Promise<void>}
 */
async function runCycle(ctx) {
  if (ctx.shuttingDown || ctx.isChecking) return;
  ctx.isChecking = true;

  try {
    const allAlerts = await getDexAlerts();
    if (allAlerts.length === 0) {
      console.log('⏸️ Нет активных DEX алертов');
      return;
    }

    console.log(`🔄 DEX проверка: ${allAlerts.length} алертов`);

    // Get blocked users
    const blockedUsersSet = await getBlockedUsers();

    // Group unique addresses by chain, excluding blocked users
    const uniqueByChain = new Map(); // chain -> Set<address>
    for (const alert of allAlerts) {
      if (blockedUsersSet.has(alert.ownerId)) {
        continue;
      }
      const chain = alert.target.chain;
      const address = alert.target.address;
      if (!uniqueByChain.has(chain)) {
        uniqueByChain.set(chain, new Set());
      }
      uniqueByChain.get(chain).add(address);
    }

    // Fetch prices for all chains
    const priceCache = new Map(); // "chain:address" -> {price, symbol, url}
    for (const [chain, addrSet] of uniqueByChain) {
      const addresses = [...addrSet];
      for (let i = 0; i < addresses.length; i += config.dexPrice.batchSize) {
        const batch = addresses.slice(i, i + config.dexPrice.batchSize);
        const data = await fetchBatchPrices(chain, batch);
        for (const [addr, info] of Object.entries(data)) {
          priceCache.set(`${chain}:${addr}`, info);
        }
        if (i + config.dexPrice.batchSize < addresses.length) {
          await new Promise(r => setTimeout(r, config.dexPrice.batchDelayMs));
        }
      }
    }

    // Evaluate conditions and prepare alerts
    const alerts = []; // {chatId, text, alertId, newBaseline}
    for (const alert of allAlerts) {
      if (blockedUsersSet.has(alert.ownerId)) {
        continue;
      }
      const cached = priceCache.get(`${alert.target.chain}:${alert.target.address}`);
      if (!cached) continue;

      const result = evaluate(alert, cached.price);

      // First run: no baseline yet — set it, no alert
      if (result.needsBaseline) {
        await updateAlertBaseline(alert._id, result.newBaseline);
        continue;
      }

      // Порог не достигнут либо входные данные некорректны — пропускаем без изменения baseline
      if (!result.triggered) continue;

      // Alert fired
      {
        const dir = result.direction === 'up' ? '🚀' : '🔻';
        const sign = result.direction === 'up' ? '+' : '';
        const escapedSymbol = escapeHtml(cached.symbol.toUpperCase());
        const escapedUrl = escapeHtml(cached.url);
        const message = `${dir} <a href="${escapedUrl}">${escapedSymbol}</a> ${sign}${result.changePct.toFixed(2)}%\nЦена: $${formatPrice(cached.price)}`;

        alerts.push({
          chatId: alert.ownerId,
          text: message,
          alertId: alert._id,
          newBaseline: result.newBaseline,
        });
      }
    }

    // Send notifications
    for (const alert of alerts) {
      await sendTelegram(alert.chatId, alert.text);
      // Update baseline after sending alert
      if (alert.newBaseline) {
        await updateAlertBaseline(alert.alertId, alert.newBaseline);
      }
    }

    console.log(`✅ DEX цикл завершён: ${alerts.length} уведомлений отправлено`);
  } finally {
    ctx.isChecking = false;
  }
}

module.exports = {
  initCollections,
  runCycle,
  fetchBatchPrices,
  getDexAlerts,
  formatPrice,
  type: 'dex_price', // Для scheduler
};