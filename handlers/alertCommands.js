// ==============================
// Alert CRUD Operations
// ==============================

const { ObjectId } = require('mongodb');

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

// ============ Alert CRUD ============

/**
 * Get user's alerts
 * @param {string} ownerId - Owner's chat ID
 * @returns {Promise<Array>} User's alerts
 */
async function getUserAlerts(ownerId) {
  return await alertsCollection.find({ ownerId, source: 'dex' }).toArray();
}

/**
 * Add new alert
 * @param {string} ownerId - Owner's chat ID
 * @param {string} chain - Chain ID
 * @param {string} address - Token address
 * @param {string} name - Token name
 * @param {number} changePercent - Change threshold percent
 */
// Basic address validation (EVM or Solana format)
function isValidTokenAddress(address) {
  const isEvm = /^0x[0-9a-fA-F]{40}$/.test(address);
  const isSolana = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  return isEvm || isSolana;
}

async function addAlert(ownerId, chain, address, name, changePercent = 10) {
  // Валидация входных данных для защиты от инъекций
  if (!ownerId || typeof ownerId !== 'string') {
    throw new Error('Invalid ownerId');
  }

  if (!chain || typeof chain !== 'string' || chain.length > 50) {
    throw new Error('Invalid chain');
  }

  if (!isValidTokenAddress(address)) {
    throw new Error('Invalid token address');
  }

  if (name && (name.length > 100 || typeof name !== 'string')) {
    name = name.slice(0, 100);
  }

  const trimmedName = (name || '').slice(0, 30);

  // Validate changePercent
  if (typeof changePercent !== 'number' || changePercent <= 0 || changePercent > 1000) {
    throw new Error('Invalid changePercent value');
  }

  // Enforce per-user token limit (default 20 if user has no maxTokens set)
  const currentCount = await alertsCollection.countDocuments({ ownerId });
  const user = await usersCollection.findOne({ _id: ownerId });
  const limit = user?.maxTokens ?? 20;
  if (currentCount >= limit) {
    throw new Error(`TOKEN_LIMIT_REACHED:${limit}`);
  }

  await alertsCollection.insertOne({
    ownerId,
    source: 'dex',
    target: {
      chain: chain.toLowerCase(),
      address: address.toLowerCase(),
    },
    condition: {
      kind: 'percent_change',
      changePercent: Number(changePercent),
      baselinePrice: null,
    },
    repeat: 'always',
    status: 'active',
    name: trimmedName,
    createdAt: new Date(),
  });
}

/**
 * Remove alert by ID
 * @param {ObjectId} alertId - Alert ID
 * @param {string} ownerId - Owner's chat ID
 */
async function removeAlert(alertId, ownerId) {
  await alertsCollection.deleteOne({ _id: alertId, ownerId });
}

/**
 * Update alert threshold
 * @param {ObjectId} alertId - Alert ID
 * @param {string} ownerId - Owner's chat ID
 * @param {number} newPercent - New threshold
 */
async function updateAlertThreshold(alertId, ownerId, newPercent) {
  if (!ownerId || typeof ownerId !== 'string') {
    throw new Error('Invalid ownerId');
  }
  if (typeof newPercent !== 'number' || newPercent <= 0 || newPercent > 1000) {
    throw new Error('Invalid newPercent value');
  }

  await alertsCollection.updateOne(
    { _id: alertId, ownerId },
    { $set: { 'condition.changePercent': Number(newPercent) } }
  );
}

/**
 * Reset all baselines for user
 * @param {string} ownerId - Owner's chat ID
 */
async function resetBaselines(ownerId) {
  if (!ownerId || typeof ownerId !== 'string') {
    throw new Error('Invalid ownerId');
  }

  await alertsCollection.updateMany(
    { ownerId },
    { $set: { 'condition.baselinePrice': null } }
  );
}

/**
 * Update threshold for all user's alerts
 * @param {string} ownerId - Owner's chat ID
 * @param {number} newPercent - New threshold
 */
async function updateAllThresholds(ownerId, newPercent) {
  if (!ownerId || typeof ownerId !== 'string') {
    throw new Error('Invalid ownerId');
  }
  if (typeof newPercent !== 'number' || newPercent <= 0 || newPercent > 1000) {
    throw new Error('Invalid newPercent value');
  }

  await alertsCollection.updateMany(
    { ownerId },
    { $set: { 'condition.changePercent': Number(newPercent) } }
  );
}

module.exports = {
  initCollections,
  getUserAlerts,
  addAlert,
  removeAlert,
  updateAlertThreshold,
  resetBaselines,
  updateAllThresholds,
  isValidTokenAddress
};