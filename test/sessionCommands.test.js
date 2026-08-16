// ==============================
// Tests for handlers/sessionCommands.js
// ==============================

const {
  initCollections,
  getSession,
  isRateLimited,
  startSessionCleanup,
  stopSessionCleanup,
  handleBroadcastStart,
  handleBroadcastMessage,
  handleRemoveStart,
  handleRemoveSelect,
  handleRemoveConfirm,
  handleChangeStart,
  handleChangeSelect,
  handleChangeValue,
  handleChangeAllStart,
  handleChangeAllValue,
  handleAddStart,
  handleAddAddress,
  handleAddConfirm,
  handleResetAnchors,
  handleCancel,
} = require('../handlers/sessionCommands');

describe('sessionCommands.js', () => {
  let mockAlertsCollection;
  let mockUsersCollection;

  beforeEach(() => {
    mockAlertsCollection = {
      countDocuments: jest.fn().mockResolvedValue(100),
      find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
      deleteMany: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({}),
    };
    mockUsersCollection = {
      countDocuments: jest.fn().mockResolvedValue(100),
      find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    };
    initCollections(mockAlertsCollection, mockUsersCollection);
  });

  afterEach(() => {
    jest.clearAllMocks();
    stopSessionCleanup();
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

  describe('startSessionCleanup / stopSessionCleanup', () => {
    test('startSessionCleanup creates interval', () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      startSessionCleanup();
      expect(clearIntervalSpy).not.toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });

    test('stopSessionCleanup clears interval', () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      startSessionCleanup();
      stopSessionCleanup();
      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
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

  describe('handleBroadcastMessage', () => {
    test('sends success when under limit', async () => {
      mockUsersCollection.countDocuments.mockResolvedValueOnce(5);
      const mockUsers = [
        { _id: '111' },
        { _id: '222' },
      ];
      mockUsersCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue(mockUsers),
      });
      const sendTelegram = jest.fn().mockResolvedValue(true);
      const session = { state: 'awaiting_broadcast_message', pendingData: {} };

      await handleBroadcastMessage('123', 'Hello', sendTelegram, (str) => str, session);

      expect(sendTelegram).toHaveBeenCalledWith('111', 'Hello');
      expect(sendTelegram).toHaveBeenCalledWith('222', 'Hello');
      expect(sendTelegram).toHaveBeenCalledWith(
        '123',
        '✅ Рассылка завершена. Успешно: 2, ошибок: 0'
      );
      expect(session.state).toBe(null);
      expect(session.pendingData).toEqual({});
    });

    test('sends error when over limit', async () => {
      mockUsersCollection.countDocuments.mockResolvedValueOnce(1001);
      const sendTelegram = jest.fn();
      const session = { state: 'awaiting_broadcast_message', pendingData: {} };

      await handleBroadcastMessage('123', 'Hello', sendTelegram, (str) => str, session);

      expect(sendTelegram).toHaveBeenCalledWith(
        '123',
        '⚠️ Превышено максимальное количество получателей (1001). Максимум: 1000.'
      );
      expect(session.state).toBe(null);
      expect(session.pendingData).toEqual({});
    });

    test('counts failures', async () => {
      mockUsersCollection.countDocuments.mockResolvedValueOnce(2);
      mockUsersCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { _id: '111' },
          { _id: '222' },
        ]),
      });
      const sendTelegram = jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      const session = { state: 'awaiting_broadcast_message', pendingData: {} };

      await handleBroadcastMessage('123', 'Hello', sendTelegram, (str) => str, session);

      expect(sendTelegram).toHaveBeenCalledWith(
        '123',
        '✅ Рассылка завершена. Успешно: 1, ошибок: 1'
      );
    });
  });

  describe('handleRemoveStart', () => {
    test('sends message when no alerts', async () => {
      const getUserAlerts = jest.fn().mockResolvedValue([]);
      const sendTelegram = jest.fn();
      const session = { state: null, pendingData: {} };

      await handleRemoveStart('123', sendTelegram, getUserAlerts, (str) => str, session);

      expect(sendTelegram).toHaveBeenCalledWith('123', '📭 У вас нет токенов для удаления.');
      expect(session.state).toBeNull();
    });

    test('shows list of alerts', async () => {
      const getUserAlerts = jest.fn().mockResolvedValue([
        { _id: 'a1', name: 'ETH', target: { chain: 'ethereum', address: '0x1234' } },
        { _id: 'a2', target: { chain: 'solana', address: '111111' } },
      ]);
      const sendTelegram = jest.fn();
      const session = { state: null, pendingData: {} };

      await handleRemoveStart('123', sendTelegram, getUserAlerts, (str) => str, session);

      expect(sendTelegram).toHaveBeenCalledWith(
        '123',
        expect.stringContaining('ETH')
      );
      expect(sendTelegram).toHaveBeenCalledWith(
        '123',
        expect.stringContaining('ethereum')
      );
      expect(sendTelegram).toHaveBeenCalledWith(
        '123',
        expect.stringContaining('111111')
      );
      expect(sendTelegram).toHaveBeenCalledWith(
        '123',
        expect.stringContaining('solana')
      );
      expect(session.state).toBe('awaiting_remove_select');
    });
  });

  describe('handleRemoveSelect', () => {
    test('rejects invalid number', async () => {
      const getUserAlerts = jest.fn().mockResolvedValue([
        { _id: 'a1', name: 'ETH', target: { chain: 'ethereum', address: '0x1234' } },
      ]);
      const sendTelegram = jest.fn();
      const session = { state: null, pendingData: {} };

      await handleRemoveSelect('123', 'abc', sendTelegram, getUserAlerts, (str) => str, session);

      expect(sendTelegram).toHaveBeenCalledWith(
        '123',
        '❌ Введите правильный номер токена из списка или /cancel для отмены.'
      );
    });

    test('shows confirmation for valid selection', async () => {
      const getUserAlerts = jest.fn().mockResolvedValue([
        { _id: 'a1', name: 'ETH', target: { chain: 'ethereum', address: '0x1234' } },
      ]);
      const sendTelegram = jest.fn().mockResolvedValue(true);
      const session = { state: null, pendingData: {} };

      await handleRemoveSelect('123', '1', sendTelegram, getUserAlerts, (str) => str, session);

      expect(session.pendingData).toEqual({ removeAlertId: 'a1' });
      expect(session.state).toBe('awaiting_remove_confirm');
      expect(sendTelegram).toHaveBeenCalledWith(
        '123',
        expect.stringContaining('ETH')
      );
      expect(sendTelegram).toHaveBeenCalledWith(
        '123',
        expect.stringContaining('0x1234')
      );
    });
  });

  describe('handleRemoveConfirm', () => {
    test('removes alert when yes', async () => {
      const removeAlert = jest.fn().mockResolvedValue({});
      const sendTelegram = jest.fn().mockResolvedValue(true);
      const session = { state: 'awaiting_remove_confirm', pendingData: { removeAlertId: 'a1' } };

      await handleRemoveConfirm('123', 'yes', sendTelegram, removeAlert, session);

      expect(removeAlert).toHaveBeenCalledWith('a1', '123');
      expect(sendTelegram).toHaveBeenCalledWith('123', '✅ Алерт удалён.');
      expect(session.state).toBe(null);
      expect(session.pendingData).toEqual({});
    });

    test('cancels when no', async () => {
      const removeAlert = jest.fn();
      const sendTelegram = jest.fn().mockResolvedValue(true);
      const session = { state: 'awaiting_remove_confirm', pendingData: { removeAlertId: 'a1' } };

      await handleRemoveConfirm('123', 'no', sendTelegram, removeAlert, session);

      expect(removeAlert).not.toHaveBeenCalled();
      expect(sendTelegram).toHaveBeenCalledWith('123', '❌ Удаление отменено.');
      expect(session.state).toBe(null);
    });
  });

  describe('handleChangeStart', () => {
    test('sends message when no alerts', async () => {
      const getUserAlerts = jest.fn().mockResolvedValue([]);
      const sendTelegram = jest.fn();
      const session = { state: null, pendingData: {} };

      await handleChangeStart('123', sendTelegram, getUserAlerts, (str) => str, session);

      expect(sendTelegram).toHaveBeenCalledWith('123', '📭 У вас нет токенов для изменения.');
    });

    test('shows list of alerts with thresholds', async () => {
      const getUserAlerts = jest.fn().mockResolvedValue([
        { _id: 'a1', name: 'ETH', target: { chain: 'ethereum' }, condition: { changePercent: 5 } },
      ]);
      const sendTelegram = jest.fn();
      const session = { state: null, pendingData: {} };

      await handleChangeStart('123', sendTelegram, getUserAlerts, (str) => str, session);

      expect(sendTelegram).toHaveBeenCalledWith(
        '123',
        expect.stringContaining('ETH')
      );
      expect(sendTelegram).toHaveBeenCalledWith(
        '123',
        expect.stringContaining('5%')
      );
      expect(session.state).toBe('awaiting_change_select');
    });
  });

  describe('handleChangeSelect', () => {
    test('rejects invalid number', async () => {
      const getUserAlerts = jest.fn().mockResolvedValue([
        { _id: 'a1', name: 'ETH', target: { chain: 'ethereum' }, condition: { changePercent: 5 } },
      ]);
      const sendTelegram = jest.fn();
      const session = { state: null, pendingData: {} };

      await handleChangeSelect('123', '0', sendTelegram, getUserAlerts, (str) => str, session);

      expect(sendTelegram).toHaveBeenCalledWith(
        '123',
        '❌ Введите правильный номер токена из списка или /cancel для отмены.'
      );
    });

    test('prompts for new value', async () => {
      const getUserAlerts = jest.fn().mockResolvedValue([
        { _id: 'a1', name: 'ETH', target: { chain: 'ethereum' }, condition: { changePercent: 5 } },
      ]);
      const sendTelegram = jest.fn().mockResolvedValue(true);
      const session = { state: null, pendingData: {} };

      await handleChangeSelect('123', '1', sendTelegram, getUserAlerts, (str) => str, session);

      expect(session.pendingData).toEqual({ changeAlertId: 'a1' });
      expect(session.state).toBe('awaiting_change_value');
      expect(sendTelegram).toHaveBeenCalledWith(
        '123',
        expect.stringContaining('5%')
      );
    });
  });

  describe('handleChangeValue', () => {
    test('rejects invalid percent', async () => {
      const sendTelegram = jest.fn();
      const updateAlertThreshold = jest.fn();
      const session = { state: 'awaiting_change_value', pendingData: { changeAlertId: 'a1' } };

      await handleChangeValue('123', 'abc', sendTelegram, updateAlertThreshold, session);

      expect(sendTelegram).toHaveBeenCalledWith('123', '❌ Пожалуйста, введите положительное число.');
      expect(updateAlertThreshold).not.toHaveBeenCalled();
    });

    test('updates threshold', async () => {
      const sendTelegram = jest.fn().mockResolvedValue(true);
      const updateAlertThreshold = jest.fn().mockResolvedValue({});
      const session = { state: 'awaiting_change_value', pendingData: { changeAlertId: 'a1' } };

      await handleChangeValue('123', '15', sendTelegram, updateAlertThreshold, session);

      expect(updateAlertThreshold).toHaveBeenCalledWith('a1', '123', 15);
      expect(sendTelegram).toHaveBeenCalledWith('123', '✅ Порог изменения обновлён до 15%');
      expect(session.state).toBe(null);
    });
  });

  describe('handleChangeAllStart', () => {
    test('starts change all flow', () => {
      const sendTelegram = jest.fn();
      const session = { state: null, pendingData: {} };

      handleChangeAllStart('123', sendTelegram, session);

      expect(session.state).toBe('awaiting_change_all_value');
      expect(sendTelegram).toHaveBeenCalledWith(
        '123',
        'Введите новый порог изменения % для всех ваших токенов (от 0.1 до 1000):'
      );
    });
  });

  describe('handleChangeAllValue', () => {
    test('rejects invalid percent', async () => {
      const sendTelegram = jest.fn();
      const updateAllThresholds = jest.fn();
      const session = { state: 'awaiting_change_all_value', pendingData: {} };

      await handleChangeAllValue('123', 'abc', sendTelegram, updateAllThresholds, session);

      expect(sendTelegram).toHaveBeenCalledWith('123', '❌ Пожалуйста, введите положительное число.');
      expect(updateAllThresholds).not.toHaveBeenCalled();
    });

    test('updates all thresholds', async () => {
      const sendTelegram = jest.fn().mockResolvedValue(true);
      const updateAllThresholds = jest.fn().mockResolvedValue({});
      const session = { state: 'awaiting_change_all_value', pendingData: {} };

      await handleChangeAllValue('123', '20', sendTelegram, updateAllThresholds, session);

      expect(updateAllThresholds).toHaveBeenCalledWith('123', 20);
      expect(sendTelegram).toHaveBeenCalledWith('123', '✅ Порог изменения для всех токенов обновлён до 20%');
      expect(session.state).toBe(null);
    });
  });

  describe('handleAddStart', () => {
    test('starts add flow', () => {
      const sendTelegram = jest.fn();
      const session = { state: null, pendingData: {} };

      handleAddStart('123', sendTelegram, session);

      expect(session.state).toBe('awaiting_add_address');
      expect(sendTelegram).toHaveBeenCalledWith('123', 'Введите адрес токена (contract address):');
    });
  });

  describe('handleAddAddress', () => {
    test('shows token info on success', async () => {
      const fetchTokenInfo = jest.fn().mockResolvedValue({
        chain: 'ethereum',
        name: 'ETH',
        address: '0x1234',
      });
      const sendTelegram = jest.fn().mockResolvedValue(true);
      const session = { state: null, pendingData: {} };

      await handleAddAddress('123', '0x1234', sendTelegram, fetchTokenInfo, (str) => str, session);

      expect(session.pendingData).toEqual({ addAddress: '0x1234', tokenInfo: { chain: 'ethereum', name: 'ETH', address: '0x1234' } });
      expect(session.state).toBe('awaiting_add_confirm');
      expect(sendTelegram).toHaveBeenCalledWith(
        '123',
        expect.stringContaining('ETH')
      );
      expect(sendTelegram).toHaveBeenCalledWith(
        '123',
        expect.stringContaining('ethereum')
      );
    });

    test('shows error on fetch failure', async () => {
      const fetchTokenInfo = jest.fn().mockResolvedValue(null);
      const sendTelegram = jest.fn();
      const session = { state: null, pendingData: {} };

      await handleAddAddress('123', '0x1234', sendTelegram, fetchTokenInfo, (str) => str, session);

      expect(sendTelegram).toHaveBeenCalledWith(
        '123',
        '❌ Не удалось получить информацию о токене. Проверьте адрес и попробуйте снова.'
      );
      expect(session.state).toBe(null);
      expect(session.pendingData).toEqual({});
    });
  });

  describe('handleAddConfirm', () => {
    test('adds alert successfully', async () => {
      const addAlert = jest.fn().mockResolvedValue({});
      const sendTelegram = jest.fn().mockResolvedValue(true);
      const session = {
        state: 'awaiting_add_confirm',
        pendingData: {
          addAddress: '0x1234',
          tokenInfo: { chain: 'ethereum', name: 'ETH', address: '0x1234' },
        },
      };

      await handleAddConfirm('123', '10', sendTelegram, addAlert, session);

      expect(addAlert).toHaveBeenCalledWith('123', 'ethereum', '0x1234', 'ETH', 10);
      expect(sendTelegram).toHaveBeenCalledWith(
        '123',
        expect.stringContaining('ETH')
      );
      expect(session.state).toBe(null);
    });

    test('rejects invalid percent', async () => {
      const addAlert = jest.fn();
      const sendTelegram = jest.fn();
      const session = {
        state: 'awaiting_add_confirm',
        pendingData: { addAddress: '0x1234', tokenInfo: { chain: 'ethereum', name: 'ETH' } },
      };

      await handleAddConfirm('123', 'abc', sendTelegram, addAlert, session);

      expect(sendTelegram).toHaveBeenCalledWith('123', '❌ Пожалуйста, введите положительное число для процента.');
      expect(addAlert).not.toHaveBeenCalled();
    });

    test('handles TOKEN_LIMIT_REACHED error', async () => {
      const addAlert = jest.fn().mockRejectedValue(new Error('TOKEN_LIMIT_REACHED:20'));
      const sendTelegram = jest.fn();
      const session = {
        state: 'awaiting_add_confirm',
        pendingData: { addAddress: '0x1234', tokenInfo: { chain: 'ethereum', name: 'ETH' } },
      };

      await handleAddConfirm('123', '10', sendTelegram, addAlert, session);

      expect(sendTelegram).toHaveBeenCalledWith(
        '123',
        '❌ Лимит 20 токенов достигнут. Удалите ненужные токены, чтобы добавить новый.'
      );
    });

    test('handles duplicate token error', async () => {
      const addAlert = jest.fn().mockRejectedValue({ code: 11000 });
      const sendTelegram = jest.fn();
      const session = {
        state: 'awaiting_add_confirm',
        pendingData: { addAddress: '0x1234', tokenInfo: { chain: 'ethereum', name: 'ETH' } },
      };

      await handleAddConfirm('123', '10', sendTelegram, addAlert, session);

      expect(sendTelegram).toHaveBeenCalledWith(
        '123',
        '❌ Этот токен уже отслеживается в вашем списке.'
      );
    });
  });

  describe('handleResetAnchors', () => {
    test('resets baselines', async () => {
      const resetBaselines = jest.fn().mockResolvedValue({});
      const sendTelegram = jest.fn().mockResolvedValue(true);

      await handleResetAnchors('123', sendTelegram, resetBaselines);

      expect(resetBaselines).toHaveBeenCalledWith('123');
      expect(sendTelegram).toHaveBeenCalledWith(
        '123',
        '🔁 Якорные цены ваших токенов сброшены. Цикл подхватит изменения автоматически.'
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
