дconst fetch = require('node-fetch');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const tokens = require('./tokens');

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
    console.error('Ошибка Telegram:', err.message);
  }
}

async function checkToken(token) {
  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${token.address}`;
    const res = await fetch(url);
    const data = await res.json();

    const pairs = data?.pairs;
    if (!pairs || pairs.length === 0) {
      console.log(`${token.name}: данные не получены`);
      return null;
    }

    const pair = pairs.sort((a, b) =>
      (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
    )[0];

    const price = parseFloat(pair.priceUsd || 0);
    if (price === 0) return null;

    const symbol = pair.baseToken?.symbol || token.name;
    console.log(`[OK] ${symbol}: $${price}`);

    return { token, price, pair, symbol };

  } catch (err) {
    console.error(`Ошибка ${token.name}:`, err.message);
    return null;
  }
}

function formatPrice(price) {
  if (price < 0.0001) return price.toExponential(3);
  if (price < 1) return price.toPrecision(4);
  return price.toFixed(4);
}

async function main() {
  console.log(`Проверяю ${tokens.length} токенов...`);

  // Получаем предыдущие цены из переменной окружения (передаётся между запусками через артефакт)
  let prevPrices = {};
  try {
    const fs = require('fs');
    if (fs.existsSync('prices.json')) {
      prevPrices = JSON.parse(fs.readFileSync('prices.json', 'utf8'));
      console.log('Загружены предыдущие цены');
    }
  } catch (e) {
    console.log('Файл цен не найден, первый запуск');
  }

  const currentPrices = {};

  for (const token of tokens) {
    const result = await checkToken(token);
    await new Promise(r => setTimeout(r, 800));

    if (!result) continue;

    const { price, pair, symbol } = result;
    const key = token.address;
    const alerts = [];

    // Алерт: цена выше порога
    if (token.alertAbove !== null && price > token.alertAbove) {
      alerts.push(`🟢 Цена *выше* порога $${token.alertAbove}`);
    }

    // Алерт: цена ниже порога
    if (token.alertBelow !== null && price < token.alertBelow) {
      alerts.push(`🔴 Цена *ниже* порога $${token.alertBelow}`);
    }

    // Алерт: изменение между запусками
    if (token.changeAlert !== null && prevPrices[key] !== undefined) {
      const prev = prevPrices[key];
      const changePct = ((price - prev) / prev) * 100;
      if (Math.abs(changePct) >= token.changeAlert) {
        const dir = changePct > 0 ? '📈' : '📉';
        const sign = changePct > 0 ? '+' : '';
        alerts.push(`${dir} Изменение: *${sign}${changePct.toFixed(2)}%*`);
        alerts.push(`   Было: $${formatPrice(prev)} → Стало: $${formatPrice(price)}`);
      }
    }

    currentPrices[key] = price;

    if (alerts.length > 0) {
      const change24h = parseFloat(pair.priceChange?.h24 || 0);
      const volume24h = pair.volume?.h24 || 0;
      const liquidity = pair.liquidity?.usd || 0;
      const dexUrl = pair.url || '';
      const chain = token.chain.toUpperCase();

      const message =
        `⚠️ *${symbol}* (${chain})\n\n` +
        alerts.join('\n') + '\n\n' +
        `💰 Цена: *$${formatPrice(price)}*\n` +
        `📊 Объём 24ч: $${Math.round(volume24h).toLocaleString()}\n` +
        `💧 Ликвидность: $${Math.round(liquidity).toLocaleString()}\n` +
        `📉 24ч: ${change24h.toFixed(2)}%\n` +
        `🔗 [DexScreener](${dexUrl})`;

      await sendTelegram(message);
      console.log(`[АЛЕРТ] ${symbol}`);
    }
  }

  // Сохраняем текущие цены для следующего запуска
  const fs = require('fs');
  fs.writeFileSync('prices.json', JSON.stringify(currentPrices));
  console.log('Цены сохранены');
}

console.log("=== BOT STARTED ===");
console.log("Time:", new Date().toISOString());


main().catch(console.error);
