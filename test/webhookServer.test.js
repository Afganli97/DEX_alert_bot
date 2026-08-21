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

  test('closeWebhookServer resolves immediately when server not started', async () => {
    const { closeWebhookServer } = require('../webhookServer');
    await expect(closeWebhookServer()).resolves.toBeUndefined();
  });
});
