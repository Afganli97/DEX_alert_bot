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
      await handleAdminCommand('123', 'block_user abc', sendTelegram, () => true);
      expect(sendTelegram).toHaveBeenCalledWith('123', 'Usage: /admin block_user <chatId>');
      expect(mockUsersCollection.updateOne).not.toHaveBeenCalled();
    });

    test('block_user with empty targetId', async () => {
      const sendTelegram = jest.fn().mockResolvedValue(true);
      await handleAdminCommand('123', 'block_user', sendTelegram, () => true);
      expect(sendTelegram).toHaveBeenCalledWith('123', 'Usage: /admin block_user <chatId>');
      expect(mockUsersCollection.updateOne).not.toHaveBeenCalled();
    });

    test('block_user with valid targetId', async () => {
      const sendTelegram = jest.fn().mockResolvedValue(true);
      await handleAdminCommand('123', 'block_user 456', sendTelegram, () => true);
      expect(mockUsersCollection.updateOne).toHaveBeenCalledWith({ _id: '456' }, { $set: { status: 'blocked' } });
      expect(sendTelegram).toHaveBeenCalledWith('123', '✅ Пользователь 456 заблокирован.');
    });

    test('unblock_user with invalid targetId', async () => {
      const sendTelegram = jest.fn().mockResolvedValue(true);
      await handleAdminCommand('123', 'unblock_user abc', sendTelegram, () => true);
      expect(sendTelegram).toHaveBeenCalledWith('123', 'Usage: /admin unblock_user <chatId>');
      expect(mockUsersCollection.updateOne).not.toHaveBeenCalled();
    });

    test('unblock_user with valid targetId', async () => {
      const sendTelegram = jest.fn().mockResolvedValue(true);
      await handleAdminCommand('123', 'unblock_user 456', sendTelegram, () => true);
      expect(mockUsersCollection.updateOne).toHaveBeenCalledWith({ _id: '456' }, { $set: { status: 'active' } });
      expect(sendTelegram).toHaveBeenCalledWith('123', '✅ Пользователь 456 разблокирован.');
    });

    test('stats command', async () => {
      const sendTelegram = jest.fn().mockResolvedValue(true);
      await handleAdminCommand('123', 'stats', sendTelegram, () => true);
      expect(sendTelegram).toHaveBeenCalledWith(expect.stringContaining('Пользователей всего: 5'));
      expect(sendTelegram).toHaveBeenCalledWith(expect.stringContaining('Активных алертов: 10'));
    });

    test('reset_all_anchors command', async () => {
      const sendTelegram = jest.fn().mockResolvedValue(true);
      await handleAdminCommand('123', 'reset_all_anchors', sendTelegram, () => true);
      expect(mockAlertsCollection.updateMany).toHaveBeenCalled();
      expect(sendTelegram).toHaveBeenCalledWith('✅ Якорные цены всех токенов сброшены.');
    });

    test('view_user command', async () => {
      const sendTelegram = jest.fn().mockResolvedValue(true);
      await handleAdminCommand('123', 'view_user 456', sendTelegram, () => true);
      expect(mockUsersCollection.findOne).toHaveBeenCalledWith({ _id: '456' });
      expect(sendTelegram).toHaveBeenCalledWith(expect.stringContaining('Инфо о пользователе 456'));
    });

    test('unknown subcommand', async () => {
      const sendTelegram = jest.fn().mockResolvedValue(true);
      await handleAdminCommand('123', 'unknown_cmd', sendTelegram, () => true);
      expect(sendTelegram).toHaveBeenCalledWith('Неизвестная подкоманда. Доступные: stats, block_user, unblock_user, reset_all_anchors, view_user');
    });
  });
});
