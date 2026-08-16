// ==============================
// Tests for handlers/commands.js - handleMessage
// ==============================

jest.mock('../lib/users', () => ({
  ensureUser: jest.fn(),
  isAdmin: jest.fn(),
}));

jest.mock('../lib/telegram', () => ({
  escapeHtml: (str) => str,
  sendTelegram: jest.fn(),
}));

jest.mock('../handlers/sessionCommands', () => ({
  initCollections: jest.fn(),
  isRateLimited: jest.fn(),
  getSession: jest.fn(),
  handleCancel: jest.fn(),
  handleBroadcastStart: jest.fn(),
  handleBroadcastMessage: jest.fn(),
  handleRemoveStart: jest.fn(),
  handleRemoveSelect: jest.fn(),
  handleRemoveConfirm: jest.fn(),
  handleChangeStart: jest.fn(),
  handleChangeSelect: jest.fn(),
  handleChangeValue: jest.fn(),
  handleChangeAllStart: jest.fn(),
  handleChangeAllValue: jest.fn(),
  handleAddStart: jest.fn(),
  handleAddAddress: jest.fn(),
  handleAddConfirm: jest.fn(),
  handleResetAnchors: jest.fn(),
  startSessionCleanup: jest.fn(),
  stopSessionCleanup: jest.fn(),
}));

jest.mock('../handlers/utilityCommands', () => ({
  initCollections: jest.fn(),
  handleStartHelp: jest.fn(),
  handleListCommand: jest.fn(),
  handleDeleteMyData: jest.fn(),
  handleStop: jest.fn(),
  handlePrivacy: jest.fn(),
  handleResetAnchors: jest.fn(),
}));

jest.mock('../handlers/adminCommands', () => ({
  initCollections: jest.fn(),
  handleAdminCommand: jest.fn(),
}));

jest.mock('../handlers/alertCommands', () => ({
  initCollections: jest.fn(),
  getUserAlerts: jest.fn(),
  addAlert: jest.fn(),
  removeAlert: jest.fn(),
  updateAlertThreshold: jest.fn(),
  resetBaselines: jest.fn(),
  updateAllThresholds: jest.fn(),
  isValidTokenAddress: jest.fn(),
}));

jest.mock('../handlers/tokenCommands', () => ({
  initCollections: jest.fn(),
  fetchTokenInfo: jest.fn(),
}));

const { initCollections, handleMessage } = require('../handlers/commands');
const { ensureUser, isAdmin } = require('../lib/users');
const { sendTelegram } = require('../lib/telegram');
const sessionCommands = require('../handlers/sessionCommands');
const utilityCommands = require('../handlers/utilityCommands');
const adminCommands = require('../handlers/adminCommands');

describe('commands.js - handleMessage', () => {
  let mockAlertsCollection;
  let mockUsersCollection;

  beforeEach(() => {
    mockAlertsCollection = {
      deleteMany: jest.fn().mockResolvedValue({}),
      deleteOne: jest.fn().mockResolvedValue({}),
      countDocuments: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    };
    mockUsersCollection = {
      deleteOne: jest.fn().mockResolvedValue({}),
      countDocuments: jest.fn().mockResolvedValue(0),
      findOneAndUpdate: jest.fn().mockResolvedValue({ value: { _id: '123', status: 'active' } }),
    };
    
    ensureUser.mockResolvedValue({ _id: '123' });
    isAdmin.mockReturnValue(false);
    sendTelegram.mockResolvedValue(true);
    sessionCommands.isRateLimited.mockReturnValue(false);
    sessionCommands.getSession.mockReturnValue({ state: null });
    
    initCollections(mockAlertsCollection, mockUsersCollection);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('handles /start command', async () => {
    const msg = { chat: { id: '123' }, from: { username: 'test' }, text: '/start' };
    await handleMessage(msg);
    expect(ensureUser).toHaveBeenCalledWith('123', 'test');
    expect(utilityCommands.handleStartHelp).toHaveBeenCalled();
  });

  test('handles /help command', async () => {
    const msg = { chat: { id: '123' }, from: { username: 'test' }, text: '/help' };
    await handleMessage(msg);
    expect(utilityCommands.handleStartHelp).toHaveBeenCalled();
  });

  test('handles /cancel command', async () => {
    const msg = { chat: { id: '123' }, from: { username: 'test' }, text: '/cancel' };
    await handleMessage(msg);
    expect(sessionCommands.handleCancel).toHaveBeenCalled();
  });

  test('handles /list command', async () => {
    const msg = { chat: { id: '123' }, from: { username: 'test' }, text: '/list' };
    await handleMessage(msg);
    expect(utilityCommands.handleListCommand).toHaveBeenCalled();
  });

  test('handles unknown command', async () => {
    const msg = { chat: { id: '123' }, from: { username: 'test' }, text: '/unknown' };
    await handleMessage(msg);
    expect(sendTelegram).toHaveBeenCalledWith('123', expect.stringContaining('Неизвестная команда'));
  });

  test('handles empty text', async () => {
    const msg = { chat: { id: '123' }, from: { username: 'test' }, text: '' };
    await handleMessage(msg);
    expect(sendTelegram).not.toHaveBeenCalled();
  });

  test('handles rate limiting', async () => {
    sessionCommands.isRateLimited.mockReturnValue(true);
    const msg = { chat: { id: '123' }, from: { username: 'test' }, text: '/start' };
    await handleMessage(msg);
    expect(sendTelegram).toHaveBeenCalledWith('123', expect.stringContaining('Слишком много запросов'));
  });

  test('handles error gracefully', async () => {
    ensureUser.mockRejectedValueOnce(new Error('DB error'));
    const msg = { chat: { id: '123' }, from: { username: 'test' }, text: '/start' };
    await handleMessage(msg);
    expect(sendTelegram).toHaveBeenCalledWith('123', expect.stringContaining('Произошла ошибка'));
  });

  test('handles admin command', async () => {
    isAdmin.mockReturnValue(true);
    adminCommands.handleAdminCommand.mockResolvedValue(true);
    const msg = { chat: { id: '123' }, from: { username: 'test' }, text: '/admin panel' };
    await handleMessage(msg);
    expect(adminCommands.handleAdminCommand).toHaveBeenCalled();
  });

  test('handles admin command when not admin', async () => {
    isAdmin.mockReturnValue(false);
    const msg = { chat: { id: '123' }, from: { username: 'test' }, text: '/broadcast' };
    await handleMessage(msg);
    expect(sendTelegram).toHaveBeenCalledWith('123', '❌ Недоступно.');
  });

  test('exports handleMessage', () => {
    expect(typeof handleMessage).toBe('function');
  });
});
