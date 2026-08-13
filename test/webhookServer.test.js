// ==============================
// Tests for webhookServer.js
// ==============================

describe('webhookServer.js', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  test('throws error when WEBHOOK_SECRET is not set', () => {
    delete process.env.WEBHOOK_SECRET;
    const { startWebhookServer } = require('../webhookServer');
    expect(() => startWebhookServer()).toThrow('WEBHOOK_SECRET is required');
  });

  test('starts server when WEBHOOK_SECRET is set', () => {
    process.env.WEBHOOK_SECRET = 'test-secret';
    process.env.WEBHOOK_PORT = '9999';
    process.env.WEBHOOK_PATH = '/test-webhook';

    const mockListen = jest.fn();
    jest.doMock('express', () => {
      const mockApp = {
        use: jest.fn(),
        post: jest.fn((path, handler) => {
          mockApp.handler = handler;
        }),
        listen: mockListen,
      };
      return {
        __esModule: true,
        default: () => mockApp,
      };
    });

    const { startWebhookServer } = require('../webhookServer');
    startWebhookServer();

    expect(mockListen).toHaveBeenCalled();
    jest.dontMock('express');
  });
});
