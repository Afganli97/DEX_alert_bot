// ==============================
// Command handlers - Coordinated version
// ==============================

const { escapeHtml, sendTelegram } = require('../lib/telegram');
const { ensureUser, isAdmin } = require('../lib/users');

// Import all command modules
const alertCommands = require('./alertCommands');
const tokenCommands = require('./tokenCommands');
const adminCommands = require('./adminCommands');
const utilityCommands = require('./utilityCommands');
const sessionCommands = require('./sessionCommands');

let alertsCollection = null;
let usersCollection = null;

/**
 * Initialize collections for all modules
 * @param {Object} alerts - Alerts collection
 * @param {Object} users - Users collection
 */
function initCollections(alerts, users) {
  alertsCollection = alerts;
  usersCollection = users;
  
  // Initialize all modules
  alertCommands.initCollections(alerts, users);
  tokenCommands.initCollections(alerts, users);
  adminCommands.initCollections(alerts, users);
  utilityCommands.initCollections(alerts, users);
  sessionCommands.initCollections(alerts, users);
}

// ============ Message Handler ============

/**
 * Handle incoming message
 * @param {Object} msg - Telegram message object
 */
async function handleMessage(msg) {
  const chatId = msg.chat?.id?.toString() || 'unknown';
  try {
    const from = msg.from;
    const username = from.username || null;
    const text = msg.text?.trim();

    if (!text) return;

    // Update user activity
    await ensureUser(chatId, username);

    // Rate limit check
    if (sessionCommands.isRateLimited(chatId)) {
      await sendTelegram(chatId, '⚠️ Слишком много запросов. Пожалуйста, подождите перед отправкой следующей команды.');
      return;
    }

    // Get session
    const session = sessionCommands.getSession(chatId);
    const state = session.state ?? null;

    // ---------------------- Commands ----------------------
    if (text === '/start' || text === '/help') {
      await utilityCommands.handleStartHelp(chatId, sendTelegram, isAdmin, session);
      return;
    }

    if (text === '/cancel') {
      await sessionCommands.handleCancel(chatId, session, sendTelegram);
      return;
    }

    if (text === '/reset_anchors') {
      await utilityCommands.handleResetAnchors(chatId, sendTelegram, alertCommands.resetBaselines);
      return;
    }

    if (text === '/broadcast') {
      if (!isAdmin(chatId)) {
        await sendTelegram(chatId, '❌ Недоступно.');
        return;
      }
      sessionCommands.handleBroadcastStart(chatId, sendTelegram, isAdmin, session);
      return;
    }

    if (text === '/delete_my_data') {
      await utilityCommands.handleDeleteMyData(chatId, sendTelegram, alertsCollection, usersCollection);
      return;
    }

    if (text === '/stop') {
      await utilityCommands.handleStop(chatId, sendTelegram, alertsCollection, usersCollection);
      return;
    }

    if (text === '/privacy') {
      utilityCommands.handlePrivacy(chatId, sendTelegram);
      return;
    }

    // ----- Admin panel -----
    if (text.startsWith('/admin')) {
      const handled = await adminCommands.handleAdminCommand(chatId, text, sendTelegram, isAdmin);
      if (handled) return;
    }

    // ---------------------- States ----------------------
    if (state === 'awaiting_broadcast_message') {
      await sessionCommands.handleBroadcastMessage(chatId, text, sendTelegram, escapeHtml, session);
      return;
    }

    if (state === 'awaiting_remove_select') {
      await sessionCommands.handleRemoveSelect(chatId, text, sendTelegram, alertCommands.getUserAlerts, escapeHtml, session);
      return;
    }

    if (state === 'awaiting_remove_confirm') {
      await sessionCommands.handleRemoveConfirm(chatId, text, sendTelegram, alertCommands.removeAlert, session);
      return;
    }

    if (state === 'awaiting_change_select') {
      await sessionCommands.handleChangeSelect(chatId, text, sendTelegram, alertCommands.getUserAlerts, escapeHtml, session);
      return;
    }

    if (state === 'awaiting_change_value') {
      await sessionCommands.handleChangeValue(chatId, text, sendTelegram, alertCommands.updateAlertThreshold, session);
      return;
    }

    if (state === 'awaiting_change_all_value') {
      await sessionCommands.handleChangeAllValue(chatId, text, sendTelegram, alertCommands.updateAllThresholds, session);
      return;
    }

    if (state === 'awaiting_add_address') {
      await sessionCommands.handleAddAddress(chatId, text, sendTelegram, tokenCommands.fetchTokenInfo, escapeHtml, session);
      return;
    }

    if (state === 'awaiting_add_confirm') {
      await sessionCommands.handleAddConfirm(chatId, text, sendTelegram, alertCommands.addAlert, session);
      return;
    }

    // ---------------------- Simple Commands ----------------------
    if (text === '/list') {
      await utilityCommands.handleListCommand(chatId, sendTelegram, alertCommands.getUserAlerts, escapeHtml);
      return;
    }

    if (text === '/add') {
      sessionCommands.handleAddStart(chatId, sendTelegram, session);
      return;
    }

    if (text === '/remove') {
      await sessionCommands.handleRemoveStart(chatId, sendTelegram, alertCommands.getUserAlerts, escapeHtml, session);
      return;
    }

    if (text === '/change') {
      await sessionCommands.handleChangeStart(chatId, sendTelegram, alertCommands.getUserAlerts, escapeHtml, session);
      return;
    }

    if (text === '/change_all') {
      sessionCommands.handleChangeAllStart(chatId, sendTelegram, session);
      return;
    }

    await sendTelegram(chatId, '❓ Неизвестная команда. Введите /help для списка.');

  } catch (e) {
    console.error('handleMessage error:', e);
    await sendTelegram(chatId, '❌ Произошла ошибка. Попробуйте позже.');
  }
}

// Export all necessary functions for external use
module.exports = {
  initCollections,
  handleMessage,
  // Expose alert operations for checkers and other modules
  getUserAlerts: alertCommands.getUserAlerts,
  addAlert: alertCommands.addAlert,
  removeAlert: alertCommands.removeAlert,
  updateAlertThreshold: alertCommands.updateAlertThreshold,
  resetBaselines: alertCommands.resetBaselines,
  updateAllThresholds: alertCommands.updateAllThresholds,
  isValidTokenAddress: alertCommands.isValidTokenAddress
};