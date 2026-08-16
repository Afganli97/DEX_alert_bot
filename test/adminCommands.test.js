// ==============================
// Tests for handlers/adminCommands.js
// ==============================

const { initCollections, handleAdminCommand } = require('../handlers/adminCommands');

describe('adminCommands.js', () => {
  let mockAlertsCollection;
  let mockUsersCollection;

  beforeEach(() => {
    mockAlertsCollection = {
      countDocuments: jest.fn().mockResolvedValue(10),
      updateMany: jest.fn().mockResolvedValue({}),
      findOne: jest.fn().mockResolvedValue({ _id: '123', status: 'active' }),
    };
    mockUsersCollection = {
      countDocuments: jest.fn().mockResolvedValue(5),
      updateOne: jest.fn().mockResolvedValue({}),
      findOne: jest.fn().mockResolvedValue({ _id: '123', status: 'active' }),
    };
    initCollections(mockAlertsCollection, mockUsersCollection);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleAdminCommand', () => {
    test('rejects non-admin user', async () => {
      const sendTelegram = jest.fn().mockResolvedValue(true);
      const result = await handleAdminCommand('999', 'stats', sendTelegram, () => false);
      expect(sendTelegram).toHaveBeenCalledWith('999', '❌ Недоступно.');
      expect(result).toBe(true);
    });

    test('block_user with invalid targetId', async () => {
      const sendTelegram = jest.fn().mockResolvedValue(true);
      await handleAdminCommand('123', '/admin block_user abc', sendTelegram, () => true);
      expect(sendTelegram).toHaveBeenCalledWith('123', 'Usage: /admin block_user <chatId>');
      expect(mockUsersCollection.updateOne).not.toHaveBeenCalled();
    });

    test('block_user with empty targetId', async () => {
      const sendTelegram = jest.fn().mockResolvedValue(true);
      await handleAdminCommand('123', '/admin block_user', sendTelegram, () => true);
      expect(sendTelegram).toHaveBeenCalledWith('123', 'Usage: /admin block_user <chatId>');
      expect(mockUsersCollection.updateOne).not.toHaveBeenCalled();
    });

    test('block_user with valid targetId', async () => {
      const sendTelegram = jest.fn().mockResolvedValue(true);
      await handleAdminCommand('123', '/admin block_user 456', sendTelegram, () => true);
      expect(mockUsersCollection.updateOne).toHaveBeenCalledWith({ _id: '456' }, { $set: { status: 'blocked' } });
      expect(sendTelegram).toHaveBeenCalledWith('123', '✅ Пользователь 456 заблокирован.');
    });

    test('unblock_user with invalid targetId', async () => {
      const sendTelegram = jest.fn().mockResolvedValue(true);
      await handleAdminCommand('123', '/admin unblock_user abc', sendTelegram, () => true);
      expect(sendTelegram).toHaveBeenCalledWith('123', 'Usage: /admin unblock_user <chatId>');
      expect(mockUsersCollection.updateOne).not.toHaveBeenCalled();
    });

    test('unblock_user with valid targetId', async () => {
      const sendTelegram = jest.fn().mockResolvedValue(true);
      await handleAdminCommand('123', '/admin unblock_user 456', sendTelegram, () => true);
      expect(mockUsersCollection.updateOne).toHaveBeenCalledWith({ _id: '456' }, { $set: { status: 'active' } });
      expect(sendTelegram).toHaveBeenCalledWith('123', '✅ Пользователь 456 разблокирован.');
    });

    test('stats command', async () => {
      const sendTelegram = jest.fn().mockResolvedValue(true);
      await handleAdminCommand('123', '/admin stats', sendTelegram, () => true);
      const msg = sendTelegram.mock.calls[0][1];
      expect(msg).toContain('Пользователей всего: 5');
      expect(msg).toContain('Активных алертов: 10');
    });

    test('reset_all_anchors command', async () => {
      const sendTelegram = jest.fn().mockResolvedValue(true);
      await handleAdminCommand('123', '/admin reset_all_anchors', sendTelegram, () => true);
      expect(mockAlertsCollection.updateMany).toHaveBeenCalled();
      expect(sendTelegram.mock.calls[0][1]).toContain('Якорные цены всех токенов сброшены');
    });

    test('view_user command', async () => {
      const sendTelegram = jest.fn().mockResolvedValue(true);
      await handleAdminCommand('123', '/admin view_user 456', sendTelegram, () => true);
      expect(mockUsersCollection.findOne).toHaveBeenCalledWith({ _id: '456' });
      expect(sendTelegram.mock.calls[0][1]).toContain('Инфо о пользователе 456');
      expect(sendTelegram.mock.calls[0][1]).toContain('Подписка:');
    });

    test('set_subscription with invalid targetId', async () => {
      const sendTelegram = jest.fn().mockResolvedValue(true);
      await handleAdminCommand('123', '/admin set_subscription abc basic', sendTelegram, () => true);
      expect(sendTelegram).toHaveBeenCalledWith('123', 'Usage: /admin set_subscription <chatId> <basic|pro|premium>');
      expect(mockUsersCollection.updateOne).not.toHaveBeenCalled();
    });

    test('set_subscription with invalid subscription', async () => {
      const sendTelegram = jest.fn().mockResolvedValue(true);
      await handleAdminCommand('123', '/admin set_subscription 456 invalid', sendTelegram, () => true);
      expect(sendTelegram).toHaveBeenCalledWith('123', '❌ Неверный тип подписки. Доступные: basic, pro, premium');
      expect(mockUsersCollection.updateOne).not.toHaveBeenCalled();
    });

    test('set_subscription with valid targetId and subscription', async () => {
      const sendTelegram = jest.fn().mockResolvedValue(true);
      await handleAdminCommand('123', '/admin set_subscription 456 pro', sendTelegram, () => true);
      expect(mockUsersCollection.findOne).toHaveBeenCalledWith({ _id: '456' });
      expect(mockUsersCollection.updateOne).toHaveBeenCalledWith({ _id: '456' }, { $set: { subscription: 'pro' } });
      expect(sendTelegram).toHaveBeenCalledWith('123', expect.stringContaining('Подписка пользователя 456 изменена на pro'));
    });

    test('unknown subcommand', async () => {
      const sendTelegram = jest.fn().mockResolvedValue(true);
      await handleAdminCommand('123', '/admin unknown_cmd', sendTelegram, () => true);
      expect(sendTelegram.mock.calls[0][1]).toContain('Неизвестная подкоманда');
      expect(sendTelegram.mock.calls[0][1]).toContain('set_subscription');
    });
  });
});
