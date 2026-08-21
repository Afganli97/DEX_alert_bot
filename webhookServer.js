require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const commandHandlers = require('./handlers/commands');

let server = null;

function startWebhookServer() {
  const app = express();
  app.use(bodyParser.json());

  const port = process.env.WEBHOOK_PORT || 3000;
  const path = process.env.WEBHOOK_PATH || '/webhook';
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    console.error('❌ WEBHOOK_SECRET is not set in .env. Webhook server will not start securely.');
    throw new Error('WEBHOOK_SECRET is required. Set it in .env before starting the bot.');
  }

  app.post(path, async (req, res) => {
    if (secret) {
      const header = req.headers['x-telegram-bot-api-secret-token'];
      if (header !== secret) {
        console.warn('Webhook request rejected: invalid secret token');
        return res.sendStatus(403);
      }
    }

    const update = req.body;
    if (update && update.message) {
      try {
        await commandHandlers.handleMessage(update.message);
      } catch (err) {
        console.error('Error handling webhook update:', err);
      }
    }
    // Telegram expects a 200 response quickly
    res.sendStatus(200);
  });

  server = app.listen(port, () => {
    if (!process.env.WEBHOOK_URL) {
      console.warn('⚠️ WEBHOOK_URL not set in .env – bot will not receive Telegram updates');
    }
    console.log(`✅ Webhook server listening on ${port}${path}`);
  });

  return server;
}

function closeWebhookServer() {
  return new Promise(resolve => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
}

module.exports = { startWebhookServer, closeWebhookServer };
