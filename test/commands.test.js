// ==============================
// Tests for handlers/commands.js
// ==============================

const { initCollections, handleMessage } = require('../handlers/commands');

describe('commands.js', () => {
  let mockAlertsCollection;
  let mockUsersCollection;
  let mockSendTelegram;

  beforeEach(() => {
    mockAlertsCollection = {
      deleteMany: jest.fn().mockResolvedValue({}),
      deleteOne: jest.fn().mockResolvedValue({}),
    };
    mockUsersCollection = {
      deleteOne: jest.fn().mockResolvedValue({}),
    };
    mockSendTelegram = jest.fn().mockResolvedValue(true);
    initCollections(mockAlertsCollection, mockUsersCollection);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleMessage', () => {
    test('handles /start command', async () => {
      const msg = {
        chat: { id: '123' },
        from: { username: 'testuser' },
        text: '/start',
      };
      await handleMessage(msg);
      expect(mockSendTelegram).toHaveBeenCalled();
    });

    test('handles /help command', async () => {
      const msg = {
        chat: { id: '123' },
        from: { username: 'testuser' },
        text: '/help',
      };
      await handleMessage(msg);
      expect(mockSendTelegram).toHaveBeenCalled();
    });

    test('handles /cancel command', async () => {
      const msg = {
        chat: { id: '123' },
        from: { username: 'testuser' },
        text: '/cancel',
      };
      await handleMessage(msg);
      expect(mockSendTelegram).toHaveBeenCalled();
    });

    test('handles /list command', async () => {
      const msg = {
        chat: { id: '123' },
        from: { username: 'testuser' },
        text: '/list',
      };
      await handleMessage(msg);
      expect(mockSendTelegram).toHaveBeenCalled();
    });

    test('handles /add command', async () => {
      const msg = {
        chat: { id: '123' },
        from: { username: 'testuser' },
        text: '/add',
      };
      await handleMessage(msg);
      expect(mockSendTelegram).toHaveBeenCalled();
    });

    test('handles /remove command', async () => {
      const msg = {
        chat: { id: '123' },
        from: { username: 'testuser' },
        text: '/remove',
      };
      await handleMessage(msg);
      expect(mockSendTelegram).toHaveBeenCalled();
    });

    test('handles /change command', async () => {
      const msg = {
        chat: { id: '123' },
        from: { username: 'testuser' },
        text: '/change',
      };
      await handleMessage(msg);
      expect(mockSendTelegram).toHaveBeenCalled();
    });

    test('handles /change_all command', async () => {
      const msg = {
        chat: { id: '123' },
        from: { username: 'testuser' },
        text: '/change_all',
      };
      await handleMessage(msg);
      expect(mockSendTelegram).toHaveBeenCalled();
    });

    test('handles /reset_anchors command', async () => {
      const msg = {
        chat: { id: '123' },
        from: { username: 'testuser' },
        text: '/reset_anchors',
      };
      await handleMessage(msg);
      expect(mockSendTelegram).toHaveBeenCalled();
    });

    test('handles /stop command', async () => {
      const msg = {
        chat: { id: '123' },
        from: { username: 'testuser' },
        text: '/stop',
      };
      await handleMessage(msg);
      expect(mockSendTelegram).toHaveBeenCalled();
    });

    test('handles /delete_my_data command', async () => {
      const msg = {
        chat: { id: '123' },
        from: { username: 'testuser' },
        text: '/delete_my_data',
      };
      await handleMessage(msg);
      expect(mockSendTelegram).toHaveBeenCalled();
    });

    test('handles /privacy command', async () => {
      const msg = {
        chat: { id: '123' },
        from: { username: 'testuser' },
        text: '/privacy',
      };
      await handleMessage(msg);
      expect(mockSendTelegram).toHaveBeenCalled();
    });

    test('handles empty message', async () => {
      const msg = {
        chat: { id: '123' },
        from: { username: 'testuser' },
        text: '',
      };
      await handleMessage(msg);
      expect(mockSendTelegram).not.toHaveBeenCalled();
    });

    test('handles rate limiting', async () => {
      const msg = {
        chat: { id: '123' },
        from: { username: 'testuser' },
        text: '/start',
      };
      // Simulate rate limit by calling isRateLimited multiple times
      for (let i = 0; i < 15; i++) {
        await handleMessage(msg);
      }
      // Next call should be rate limited
      await handleMessage(msg);
      expect(mockSendTelegram).toHaveBeenCalledWith(
        '123',
        '⚠️ Слишком много запросов. Пожалуйста, подождите перед отправкой следующей команды.'
      );
    });

    test('handles error gracefully', async () => {
      const msg = {
        chat: { id: '123' },
        from: { username: 'testuser' },
        text: '/start',
      };
      // Mock ensureUser to throw
      jest.spyOn(require('../lib/users'), 'ensureUser').mockRejectedValueOnce(new Error('DB error'));
      await handleMessage(msg);
      expect(mockSendTelegram).toHaveBeenCalledWith('123', '❌ Произошла ошибка. Попробуйте позже.');
    });
  });
});
