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

// In beforeEach we will set getSession mock to return the session object


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

// ==============================
// Tests for handlers/commands.js state routing
// ==============================

describe('commands.js state routing', () => {
  let mockSendTelegram;
  let mockGetUserAlerts;
  let mockFetchTokenInfo;
  let session;

  beforeEach(() => {
    mockSendTelegram = jest.fn();
    mockGetUserAlerts = jest.fn().mockResolvedValue([]);
    mockFetchTokenInfo = jest.fn().mockResolvedValue({ name: 'ETH', chain: 'ethereum', address: '0xabc' });
    session = { state: null, chatId: '123' };
    
    // Override sessionCommands getSession mock for state handling
    sessionCommands.getSession.mockReturnValue(session);
    
    // Override alertCommands and tokenCommands mocks
    const alertCommands = require('../handlers/alertCommands');
    const tokenCommands = require('../handlers/tokenCommands');
    alertCommands.getUserAlerts.mockResolvedValue([]);
    alertCommands.addAlert.mockResolvedValue();
    tokenCommands.fetchTokenInfo.mockResolvedValue({ name: 'ETH', chain: 'ethereum', address: '0xabc' });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('broadcast message state routes correctly', async () => {
    session.state = 'awaiting_broadcast_message';
    const msg = { chat: { id: '123' }, from: { id: '123' }, text: 'Hello broadcast' };
    await handleMessage(msg);
    expect(sessionCommands.handleBroadcastMessage).toHaveBeenCalledWith('123', 'Hello broadcast', expect.any(Function), expect.any(Function), session);
  });

  test('remove select state routes correctly', async () => {
    session.state = 'awaiting_remove_select';
    const msg = { chat: { id: '123' }, from: { id: '123' }, text: '5' };
    await handleMessage(msg);
    expect(sessionCommands.handleRemoveSelect).toHaveBeenCalledWith('123', '5', expect.any(Function), expect.any(Function), expect.any(String), session);
  });

  test('remove confirm state routes correctly', async () => {
    session.state = 'awaiting_remove_confirm';
    const msg = { chat: { id: '123' }, from: { id: '123' }, text: 'yes' };
    await handleMessage(msg);
    expect(sessionCommands.handleRemoveConfirm).toHaveBeenCalledWith('123', 'yes', expect.any(Function), session);
  });

  test('change select state routes correctly', async () => {
    session.state = 'awaiting_change_select';
    const msg = { chat: { id: '123' }, from: { id: '123' }, text: '1' };
    await handleMessage(msg);
    expect(sessionCommands.handleChangeSelect).toHaveBeenCalledWith('123', '1', expect.any(Function), expect.any(Function), expect.any(String), session);
  });

  test('change value state routes correctly', async () => {
    session.state = 'awaiting_change_value';
    const msg = { chat: { id: '123' }, from: { id: '123' }, text: '15' };
    await handleMessage(msg);
    expect(sessionCommands.handleChangeValue).toHaveBeenCalledWith('123', '15', expect.any(Function), session);
  });

  test('change all value state routes correctly', async () => {
    session.state = 'awaiting_change_all_value';
    const msg = { chat: { id: '123' }, from: { id: '123' }, text: '20' };
    await handleMessage(msg);
    expect(sessionCommands.handleChangeAllValue).toHaveBeenCalledWith('123', '20', expect.any(Function), session);
  });

  test('add address state routes correctly', async () => {
    session.state = 'awaiting_add_address';
    const msg = { chat: { id: '123' }, from: { id: '123' }, text: '0xabc' };
    await handleMessage(msg);
    expect(sessionCommands.handleAddAddress).toHaveBeenCalledWith('123', '0xabc', expect.any(Function), expect.any(String), session);
  });

  test('add confirm state routes correctly', async () => {
    session.state = 'awaiting_add_confirm';
    const msg = { chat: { id: '123' }, from: { id: '123' }, text: 'yes' };
    await handleMessage(msg);
    expect(sessionCommands.handleAddConfirm).toHaveBeenCalledWith('123', 'yes', expect.any(Function), session);
  });

  test('handles /broadcast command as admin', async () => {
    isAdmin.mockReturnValue(true);
    const msg = { chat: { id: '123' }, from: { username: 'admin' }, text: '/broadcast' };
    await handleMessage(msg);
    expect(sessionCommands.handleBroadcastStart).toHaveBeenCalledWith('123', sendTelegram, isAdmin, session);
  });

  test('handles /broadcast command when not admin', async () => {
    isAdmin.mockReturnValue(false);
    const msg = { chat: { id: '123' }, from: { username: 'user' }, text: '/broadcast' };
    await handleMessage(msg);
    expect(sendTelegram).toHaveBeenCalledWith('123', '❌ Недоступно.');
  });

  test('handles /reset_anchors command', async () => {
    const msg = { chat: { id: '123' }, from: { username: 'test' }, text: '/reset_anchors' };
    await handleMessage(msg);
    expect(utilityCommands.handleResetAnchors).toHaveBeenCalledWith('123', sendTelegram, expect.any(Function));
  });

  test('handles /delete_my_data command', async () => {
    const msg = { chat: { id: '123' }, from: { username: 'test' }, text: '/delete_my_data' };
    await handleMessage(msg);
    expect(utilityCommands.handleDeleteMyData).toHaveBeenCalledWith('123', sendTelegram, mockAlertsCollection, mockUsersCollection);
  });

  test('handles /stop command', async () => {
    const msg = { chat: { id: '123' }, from: { username: 'test' }, text: '/stop' };
    await handleMessage(msg);
    expect(utilityCommands.handleStop).toHaveBeenCalledWith('123', sendTelegram, mockAlertsCollection, mockUsersCollection);
  });

  test('handles /privacy command', async () => {
    const msg = { chat: { id: '123' }, from: { username: 'test' }, text: '/privacy' };
    await handleMessage(msg);
    expect(utilityCommands.handlePrivacy).toHaveBeenCalledWith('123', sendTelegram);
  });

  test('handles /add command', async () => {
    const msg = { chat: { id: '123' }, from: { username: 'test' }, text: '/add' };
    await handleMessage(msg);
    expect(sessionCommands.handleAddStart).toHaveBeenCalledWith('123', sendTelegram, session);
  });

  test('handles /remove command', async () => {
    const msg = { chat: { id: '123' }, from: { username: 'test' }, text: '/remove' };
    await handleMessage(msg);
    expect(sessionCommands.handleRemoveStart).toHaveBeenCalledWith('123', sendTelegram, expect.any(Function), expect.any(String), session);
  });

  test('handles /change command', async () => {
    const msg = { chat: { id: '123' }, from: { username: 'test' }, text: '/change' };
    await handleMessage(msg);
    expect(sessionCommands.handleChangeStart).toHaveBeenCalledWith('123', sendTelegram, expect.any(Function), expect.any(String), session);
  });

  test('handles /change_all command', async () => {
    const msg = { chat: { id: '123' }, from: { username: 'test' }, text: '/change_all' };
    await handleMessage(msg);
    expect(sessionCommands.handleChangeAllStart).toHaveBeenCalledWith('123', sendTelegram, session);
  });
});