// ==============================
// Telegram queue with rate limiting
// ==============================

const { sleep } = require('./utils');

class TelegramQueue {
  /**
   * @param {Object} usersCollection - MongoDB collection for users (to update status on 403)
   */
  constructor(usersCollection) {
    this.usersCollection = usersCollection;
    this.queue = []; // массив объектов { chatId, text, resolve, reject }
    this.processing = false;
  }

  /**
   * Добавить сообщение в очередь и запустить обработку, если ещё не запущена
   * @param {string|number} chatId
   * @param {string} text
   * @returns {Promise<boolean>}
   */
  push(chatId, text) {
    return new Promise((resolve, reject) => {
      this.queue.push({ chatId, text, resolve, reject });
      this.process();
    });
  }

  /**
   * Обработка очереди по одному сообщению с интервалом ~35мс между отправками
   */
  async process() {
    if (this.processing) return;
    this.processing = true;
    while (this.queue.length) {
      const { chatId, text, resolve, reject } = this.queue.shift();
      try {
        const ok = await this.sendTelegramTo(chatId, text);
        // всегда резолвим булевым, никогда не режтим на ожидаемые ошибки (403 и т.п.)
        resolve(ok);
      } catch (err) {
        console.error('Queue send error:', err);
        resolve(false); // считаем, что сообщение не отправлено, но не прерываем очередь
      }
      // интервал ~35мс => ~28 сообщений/сек, с запасом от лимита Telegram 30/сек
      await sleep(35);
    }
    this.processing = false;
  }

  /**
   * Отправка одного сообщения через Telegram Bot API
   * @param {string|number} chatId
   * @param {string} text
   * @returns {Promise<boolean>}
   */
  async sendTelegramTo(chatId, text) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
      const data = await res.json();
      if (data.ok) return true;

      if (data.error_code === 403) {
        // Пользователь заблокировал бота — не ретраим, помечаем как blocked
        await this.usersCollection.updateOne({ _id: chatId }, { $set: { status: 'blocked' } });
        return false;
      }
      // 429: move this message to the end of the queue instead of blocking
      // the entire queue for retry_after seconds.
      if (data.error_code === 429 && data.parameters?.retry_after) {
        const retryAfter = Math.min(data.parameters.retry_after, 60); // Cap at 60s to protect against DOS
        this.queue.push({ chatId, text, resolve, reject });
        // Wait only for the rate-limit window, not the full retry_after
        await sleep(retryAfter * 1000);
        return false;
      }
      console.error('Telegram error:', data);
      return false;
    } catch (e) {
      console.error('Send error:', e);
      return false;
    }
  }
}

module.exports = { TelegramQueue };