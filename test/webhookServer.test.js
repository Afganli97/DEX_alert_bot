jest.doMock('dotenv', () => ({
  config: jest.fn()
}));

describe('webhookServer.js', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  test('throws error when WEBHOOK_SECRET is not set', () => {
    delete process.env.WEBHOOK_SECRET;
    const { startWebhookServer } = require('../webhookServer');
    console.log('WEBHOOK_SECRET:', process.env.WEBHOOK_SECRET);
    expect(() => startWebhookServer()).toThrow('WEBHOOK_SECRET is required. Set it in .env before starting the bot.');
  });

  test('closeWebhookServer resolves immediately when server not started', async () => {
    const { closeWebhookServer } = require('../webhookServer');
    await expect(closeWebhookServer()).resolves.toBeUndefined();
  });
});