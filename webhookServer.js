require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const commandHandlers = require('./handlers/commands');

function startWebhookServer() {
  const app = express();
  app.use(bodyParser.json());

  const port = process.env.WEBHOOK_PORT || 3000;
  const path = process.env.WEBHOOK_PATH || '/webhook';

  app.post(path, async (req, res) => {
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

  app.listen(port, () => {
    console.log(`✅ Webhook server listening on ${port}${path}`);
  });
}

module.exports = { startWebhookServer };
