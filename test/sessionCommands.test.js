// ==============================
// Tests for handlers/sessionCommands.js
// ==============================

const {
  initCollections,
  getSession,
  isRateLimited,
  handleBroadcastStart,
  handleCancel,
} = require('../handlers/sessionCommands');

describe('sessionCommands.js', () => {
  let mockAlertsCollection;
  let mockUsersCollection;

  beforeEach(() => {
    mockAlertsCollection = {
      countDocuments: jest.fn().mockResolvedValue(100),
      find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    };
    mockUsersCollection = {
      countDocuments: jest.fn().mockResolvedValue(100),
    };
    initCollections(mockAlertsCollection, mockUsersCollection);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSession', () => {
    test('creates new session', () => {
      const session = getSession('123');
      expect(session).toEqual(expect.objectContaining({
        state: null,
        pendingData: {},
      }));
    });

    test('returns existing session', () => {
      const session1 = getSession('123');
      session1.state = 'test';
      const session2 = getSession('123');
      expect(session2.state).toBe('test');
    });
  });

  describe('isRateLimited', () => {
    test('returns false for new user', () => {
      expect(isRateLimited('999')).toBe(false);
    });

    test('returns true after many commands', () => {
      const chatId = '123';
      for (let i = 0; i < 15; i++) {
        isRateLimited(chatId);
      }
      expect(isRateLimited(chatId)).toBe(true);
    });
  });

  describe('handleBroadcastStart', () => {
    test('sends message to non-admin', () => {
      const sendTelegram = jest.fn();
      const session = { state: null, pendingData: {} };
      handleBroadcastStart('123', sendTelegram, () => false, session);
      expect(sendTelegram).toHaveBeenCalledWith('123', '❌ Недоступно.');
    });

    test('starts broadcast for admin', () => {
      const sendTelegram = jest.fn();
      const session = { state: null, pendingData: {} };
      handleBroadcastStart('123', sendTelegram, () => true, session);
      expect(session.state).toBe('awaiting_broadcast_message');
      expect(sendTelegram).toHaveBeenCalledWith(
        '123',
        'Введите сообщение для рассылка всем активным пользователям (максимум 1000 получателей):'
      );
    });
  });

  describe('handleCancel', () => {
    test('clears session and sends message', async () => {
      const sendTelegram = jest.fn().mockResolvedValue(true);
      const session = { state: 'test', pendingData: { key: 'value' } };
      await handleCancel('123', session, sendTelegram);
      expect(session.state).toBe(null);
      expect(session.pendingData).toEqual({});
      expect(sendTelegram).toHaveBeenCalledWith('123', '🚫 Текущее действие отменено.');
    });
  });
});
