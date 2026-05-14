const fetch = require('node-fetch');
const cron = require('node-cron');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const tokens = require('./tokens');

// Здесь бот хранит последнюю известную цену каждого токена
// Сравнивает с ней при следующей проверке через 5 минут
const lastPrices = {};

async function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      })
    });
  } catch (err) {
    console.error('Ошибка отправки в Telegram:', err.message);
  }
}

async function checkToken(token) {
  try {
const url = `https://api.dexscreener.com/latest/dex/tokens/${token.address}`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data || !Array.isArray(data) || data.length === 0) {
      console.log(`${token.name}: данные не получены`);
      return;
    }

    // Берём пару с максимальной ликвидностью среди всех пулов этого токена
    const pair = data.sort((a, b) =>
      (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
    )[0];

    const price = parseFloat(pair.priceUsd || 0);
    if (price === 0) return;

    const change24h = parseFloat(pair.priceChange?.h24 || 0);
    const volume24h = pair.volume?.h24 || 0;
    const liquidity = pair.liquidity?.usd || 0;
    const dexUrl = pair.url || '';
    const symbol = pair.baseToken?.symbol || token.name;

    const key = token.address;
    const alerts = [];

    // --- АЛЕРТ 1: ЦЕНА ВЫШЕ ПОРОГА ---
    // Срабатывает каждый раз когда цена выше alertAbove при проверке
    // Чтобы выключить — поставь null в tokens.js
    if (token.alertAbove !== null && price > token.alertAbove) {
      alerts.push(`🟢 Цена *выше* порога $${token.alertAbove}`);
    }

    // --- АЛЕРТ 2: ЦЕНА НИЖЕ ПОРОГА ---
    // Срабатывает каждый раз когда цена ниже alertBelow при проверке
    if (token.alertBelow !== null && price < token.alertBelow) {
      alerts.push(`🔴 Цена *ниже* порога $${token.alertBelow}`);
    }

    // --- АЛЕРТ 3: ИЗМЕНЕНИЕ ЦЕНЫ МЕЖДУ ПРОВЕРКАМИ ---
    // Сравниваем текущую цену с той что была на предыдущей проверке (5 минут назад)
    // Если изменение >= changeAlert процентов — отправляем алерт
    // Алерт придёт КАЖДЫЙ раз когда за интервал проверки цена изменится на нужный %
    // Пример: цена была $1.00, стала $1.11 → изменение 11% → алерт если changeAlert = 10
    if (token.changeAlert !== null && lastPrices[key] !== undefined) {
      const prevPrice = lastPrices[key];
      const changePct = ((price - prevPrice) / prevPrice) * 100;

      if (Math.abs(changePct) >= token.changeAlert) {
        const dir = changePct > 0 ? '📈' : '📉';
        const sign = changePct > 0 ? '+' : '';
        alerts.push(`${dir} Изменение с последней проверки: *${sign}${changePct.toFixed(2)}%*`);
        // Показываем от какой цены считалось
        alerts.push(`   Было: $${formatPrice(prevPrice)} → Стало: $${formatPrice(price)}`);
      }
    }

    // Записываем текущую цену — она станет "предыдущей" на следующей проверке
    lastPrices[key] = price;

    // Если есть хоть один алерт — отправляем сообщение в Telegram
    if (alerts.length > 0) {
      const message =
        `⚠️ *${symbol}* (${token.chain.toUpperCase()})\n\n` +
        alerts.join('\n') + '\n\n' +
        `💰 Цена сейчас: *$${formatPrice(price)}*\n` +
        `📊 Объём 24ч: $${Math.round(volume24h).toLocaleString()}\n` +
        `💧 Ликвидность: $${Math.round(liquidity).toLocaleString()}\n` +
        `📉 Изменение 24ч: ${change24h.toFixed(2)}%\n` +
        `🔗 [Открыть на DexScreener](${dexUrl})`;

      await sendTelegram(message);
      console.log(`[АЛЕРТ] ${symbol}: $${formatPrice(price)}`);
    } else {
      console.log(`[OK] ${symbol}: $${formatPrice(price)}`);
    }

  } catch (err) {
    console.error(`Ошибка для ${token.name}:`, err.message);
  }
}

// Вспомогательная функция: форматирует цену красиво
// Маленькие числа типа 0.0000043 показывает в научной нотации
function formatPrice(price) {
  if (price < 0.0001) return price.toExponential(3);
  if (price < 1) return price.toPrecision(4);
  return price.toFixed(4);
}

async function checkAll() {
  console.log(`\n[${new Date().toISOString()}] Проверяю ${tokens.length} токенов...`);
  for (const token of tokens) {
    await checkToken(token);
    // Пауза 1 секунда между токенами чтобы не перегружать API
    await new Promise(r => setTimeout(r, 1000));
  }
}

// Запуск сразу при старте — сохраняет начальные цены (алертов ещё нет)
checkAll();

// -------------------------------------------------------
// ИНТЕРВАЛ ПРОВЕРКИ — сейчас каждые 5 минут
// Если хочешь проверять чаще — измени число:
// '*/1 * * * *'  = каждую минуту
// '*/2 * * * *'  = каждые 2 минуты
// '*/5 * * * *'  = каждые 5 минут (текущее)
// ВАЖНО: DexScreener лимит 300 запросов/мин
// При 20 токенах и проверке каждую минуту = 20 запросов/мин, всё ок
// -------------------------------------------------------
cron.schedule('*/5 * * * *', checkAll);

console.log('🤖 DEX Alerts Bot запущен');


// Фиктивный HTTP сервер чтобы Back4app не падал с ошибкой порта
// Бот работает независимо от этого сервера
const http = require('http');
http.createServer((req, res) => res.end('OK')).listen(3000);