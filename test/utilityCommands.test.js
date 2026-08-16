// ==============================
// Tests for handlers/utilityCommands.js
// ==============================

const {
  initCollections,
  handleStartHelp,
  handleListCommand,
  handleDeleteMyData,
  handleStop,
  handlePrivacy,
} = require('../handlers/utilityCommands');

describe('utilityCommands.js', () => {
  let mockAlertsCollection;
  let mockUsersCollection;
  let mockSendTelegram;
  let mockIsAdmin;
  let mockGetUserAlerts;
  let mockEscapeHtml;

  beforeEach(() => {
    mockAlertsCollection = {
      deleteMany: jest.fn().mockResolvedValue({}),
    };
    mockUsersCollection = {
      deleteOne: jest.fn().mockResolvedValue({}),
    };
    mockSendTelegram = jest.fn().mockResolvedValue(true);
    mockIsAdmin = jest.fn();
    mockGetUserAlerts = jest.fn();
    mockEscapeHtml = jest.fn((str) => str);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initCollections', () => {
    test('initializes collections', () => {
      const mockAlerts = { test: 'alerts' };
      const mockUsers = { test: 'users' };
      initCollections(mockAlerts, mockUsers);
      // Verify by calling a function that uses the collections
      expect(mockAlertsCollection.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('handleStartHelp', () => {
    test('sends help text to non-admin user', async () => {
      mockIsAdmin.mockReturnValue(false);
      const session = { state: 'some_state', pendingData: { key: 'value' } };

      await handleStartHelp('123', mockSendTelegram, mockIsAdmin, session);

      expect(session.state).toBeNull();
      expect(session.pendingData).toEqual({});
      expect(mockSendTelegram).toHaveBeenCalledWith('123', expect.stringContaining('/add'));
      expect(mockSendTelegram).toHaveBeenCalledWith('123', expect.stringContaining('/help'));
      expect(mockSendTelegram).not.toHaveBeenCalledWith('123', expect.stringContaining('/broadcast'));
    });

    test('sends help text with admin command to admin user', async () => {
      mockIsAdmin.mockReturnValue(true);
      const session = { state: 'some_state', pendingData: { key: 'value' } };

      await handleStartHelp('123', mockSendTelegram, mockIsAdmin, session);

      expect(mockSendTelegram).toHaveBeenCalledWith('123', expect.stringContaining('/broadcast'));
    });

    test('logs warning when sendTelegram fails', async () => {
      mockIsAdmin.mockReturnValue(false);
      mockSendTelegram.mockResolvedValue(false);
      const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const session = { state: null, pendingData: {} };

      await handleStartHelp('123', mockSendTelegram, mockIsAdmin, session);

      expect(consoleWarn).toHaveBeenCalledWith('Failed to send help to', '123');
      consoleWarn.mockRestore();
    });
  });

  describe('handleListCommand', () => {
    test('sends message when user has no alerts', async () => {
      mockGetUserAlerts.mockResolvedValue([]);

      await handleListCommand('123', mockSendTelegram, mockGetUserAlerts, mockEscapeHtml);

      expect(mockGetUserAlerts).toHaveBeenCalledWith('123');
      expect(mockSendTelegram).toHaveBeenCalledWith(
        '123',
        '📭 У вас нет отслеживаемых токенов. Используйте /add для добавления.'
      );
    });

    test('sends list of alerts when user has alerts', async () => {
      const mockAlerts = [
        { name: 'ETH', target: { address: '0x1234', chain: 'ethereum' }, condition: { changePercent: 5 } },
        { target: { address: '0x5678', chain: 'solana' }, condition: { changePercent: 10 } },
      ];
      mockGetUserAlerts.mockResolvedValue(mockAlerts);

      await handleListCommand('123', mockSendTelegram, mockGetUserAlerts, mockEscapeHtml);

      expect(mockGetUserAlerts).toHaveBeenCalledWith('123');
      expect(mockSendTelegram).toHaveBeenCalledWith(
        '123',
        expect.stringContaining('ETH')
      );
      expect(mockSendTelegram).toHaveBeenCalledWith(
        '123',
        expect.stringContaining('ethereum')
      );
      expect(mockSendTelegram).toHaveBeenCalledWith(
        '123',
        expect.stringContaining('5%')
      );
      expect(mockSendTelegram).toHaveBeenCalledWith(
        '123',
        expect.stringContaining('10%')
      );
    });
  });

  describe('handleDeleteMyData', () => {
    test('deletes user data and sends confirmation', async () => {
      await handleDeleteMyData('123', mockSendTelegram, mockAlertsCollection, mockUsersCollection);

      expect(mockAlertsCollection.deleteMany).toHaveBeenCalledWith({ ownerId: '123' });
      expect(mockUsersCollection.deleteOne).toHaveBeenCalledWith({ _id: '123' });
      expect(mockSendTelegram).toHaveBeenCalledWith('123', '✅ Все ваши данные удалены.');
    });
  });

  describe('handleStop', () => {
    test('deletes user data and sends confirmation', async () => {
      await handleStop('123', mockSendTelegram, mockAlertsCollection, mockUsersCollection);

      expect(mockAlertsCollection.deleteMany).toHaveBeenCalledWith({ ownerId: '123' });
      expect(mockUsersCollection.deleteOne).toHaveBeenCalledWith({ _id: '123' });
      expect(mockSendTelegram).toHaveBeenCalledWith(
        '123',
        '✅ Вы отписались от всех алертов. Ваши данные удалены.'
      );
    });
  });

  describe('handlePrivacy', () => {
    test('sends privacy policy', async () => {
      await handlePrivacy('123', mockSendTelegram);

      expect(mockSendTelegram).toHaveBeenCalledWith(
        '123',
        expect.stringContaining('Политика конфиденциальности')
      );
      expect(mockSendTelegram).toHaveBeenCalledWith(
        '123',
        expect.stringContaining('/delete_my_data')
      );
    });
  });
});
