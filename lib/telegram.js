// ==============================
// Telegram utilities: escaping, queue, and sending
// ==============================

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class TelegramQueue {
  constructor(usersCollection) {
    this.usersCollection = usersCollection;
    this.queue = [];
    this.processing = false;
  }

  push(chatId, text) {
    return new Promise((resolve, reject) => {
      this.queue.push({ chatId, text, resolve, reject });
      this.process();
    });
  }

  async process() {
    if (this.processing) return;
    this.processing = true;
    while (this.queue.length) {
      const { chatId, text, resolve, reject } = this.queue.shift();
      try {
        const ok = await this.sendTelegramTo(chatId, text);
        // always resolve boolean, never reject on expected failures (403 etc.)
        resolve(ok);
      } catch (err) {
        console.error('Queue send error:', err);
        resolve(false);
      }
      await sleep(35); // ~28 msg/сек, с запасом от лимита 30/сек
    }
    this.processing = false;
  }

  async sendTelegramTo(chatId, text) {
    try {
      const res = await fetch(`${process.env.TELEGRAM_API}/sendMessage`, {
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
      if (data.error_code === 429 && data.parameters?.retry_after) {
        await sleep(data.parameters.retry_after * 1000);
        // Одна повторная попытка после выдержки
        const retryRes = await fetch(`${process.env.TELEGRAM_API}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          }),
        });
        const retryData = await retryRes.json();
        return retryData.ok;
      }
      console.error('Telegram error:', data);
      return false;
    } catch (e) {
      console.error('Send error:', e);
      return false;
    }
  }
}

module.exports = { escapeHtml, TelegramQueue };