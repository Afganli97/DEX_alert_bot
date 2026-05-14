console.log("==================================");
console.log("DEX BOT STARTED");
console.log("TIME:", new Date().toISOString());
console.log("==================================");

console.log("TELEGRAM TOKEN EXISTS:", !!process.env.TELEGRAM_TOKEN);
console.log("CHAT_ID EXISTS:", !!process.env.CHAT_ID);

const fetch = require('node-fetch');
const fs = require('fs');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

const tokens = require('./tokens');

async function sendTelegram(message) {

  console.log("Preparing Telegram message...");

  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

  try {

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      })
    });

    const data = await response.json();

    console.log("Telegram API response:");
    console.log(JSON.stringify(data, null, 2));

    if (!data.ok) {
      console.error("Telegram send failed");
    } else {
      console.log("Telegram message sent successfully");
    }

  } catch (err) {

    console.error("==================================");
    console.error("TELEGRAM ERROR");
    console.error(err);
    console.error("==================================");

  }
}

async function checkToken(token) {

  try {

    console.log("----------------------------------");
    console.log(`Checking token: ${token.name}`);
    console.log(`Address: ${token.address}`);

    const url = `https://api.dexscreener.com/latest/dex/tokens/${token.address}`;

    console.log("Fetching DexScreener data...");

    const res = await fetch(url);

    console.log("DexScreener status:", res.status);

    const data = await res.json();

    const pairs = data?.pairs;

    if (!pairs || pairs.length === 0) {

      console.log(`${token.name}: NO PAIRS FOUND`);

      return null;
    }

    console.log(`Pairs found: ${pairs.length}`);

    const pair = pairs.sort((a, b) =>
      (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
    )[0];

    const price = parseFloat(pair.priceUsd || 0);

    if (price === 0) {

      console.log(`${token.name}: INVALID PRICE`);

      return null;
    }

    const symbol = pair.baseToken?.symbol || token.name;

    console.log(`[OK] ${symbol}: $${price}`);

    return {
      token,
      price,
      pair,
      symbol
    };

  } catch (err) {

    console.error("==================================");
    console.error(`TOKEN CHECK ERROR: ${token.name}`);
    console.error(err);
    console.error("==================================");

    return null;
  }
}

function formatPrice(price) {

  if (price < 0.0001) {
    return price.toExponential(3);
  }

  if (price < 1) {
    return price.toPrecision(4);
  }

  return price.toFixed(4);
}

async function main() {

  try {

    console.log("==================================");
    console.log("MAIN FUNCTION STARTED");
    console.log("Heartbeat:", Date.now());
    console.log("==================================");

    if (!TELEGRAM_TOKEN) {
      throw new Error("TELEGRAM_TOKEN is missing");
    }

    if (!CHAT_ID) {
      throw new Error("CHAT_ID is missing");
    }

    console.log(`Checking ${tokens.length} tokens...`);

    let prevPrices = {};

    try {

      if (fs.existsSync('prices.json')) {

        console.log("prices.json found");

        prevPrices = JSON.parse(
          fs.readFileSync('prices.json', 'utf8')
        );

        console.log("Previous prices loaded");

      } else {

        console.log("prices.json NOT found");
        console.log("First launch detected");

      }

    } catch (err) {

      console.error("Failed to load prices.json");
      console.error(err);

    }

    const currentPrices = {};

    for (const token of tokens) {

      console.log("");
      console.log("==================================");

      const result = await checkToken(token);

      console.log("Waiting 800ms before next request...");

      await new Promise(r => setTimeout(r, 800));

      if (!result) {

        console.log(`Skipping token: ${token.name}`);

        continue;
      }

      const {
        price,
        pair,
        symbol
      } = result;

      const key = token.address;

      const alerts = [];

      if (
        token.alertAbove !== null &&
        price > token.alertAbove
      ) {

        alerts.push(
          `🟢 Цена выше порога $${token.alertAbove}`
        );
      }

      if (
        token.alertBelow !== null &&
        price < token.alertBelow
      ) {

        alerts.push(
          `🔴 Цена ниже порога $${token.alertBelow}`
        );
      }

      if (
        token.changeAlert !== null &&
        prevPrices[key] !== undefined
      ) {

        const prev = prevPrices[key];

        const changePct =
          ((price - prev) / prev) * 100;

        console.log(
          `${symbol} change: ${changePct.toFixed(2)}%`
        );

        if (
          Math.abs(changePct) >= token.changeAlert
        ) {

          const dir =
            changePct > 0 ? '📈' : '📉';

          const sign =
            changePct > 0 ? '+' : '';

          alerts.push(
            `${dir} Изменение: *${sign}${changePct.toFixed(2)}%*`
          );

          alerts.push(
            `Было: $${formatPrice(prev)} → Стало: $${formatPrice(price)}`
          );
        }
      }

      currentPrices[key] = price;

      if (alerts.length > 0) {

        console.log(`ALERT TRIGGERED: ${symbol}`);

        const change24h =
          parseFloat(pair.priceChange?.h24 || 0);

        const volume24h =
          pair.volume?.h24 || 0;

        const liquidity =
          pair.liquidity?.usd || 0;

        const dexUrl =
          pair.url || '';

        const chain =
          token.chain.toUpperCase();

        const message =
          `⚠️ *${symbol}* (${chain})\n\n` +
          alerts.join('\n') + '\n\n' +
          `💰 Цена: *$${formatPrice(price)}*\n` +
          `📊 Объём 24ч: $${Math.round(volume24h).toLocaleString()}\n` +
          `💧 Ликвидность: $${Math.round(liquidity).toLocaleString()}\n` +
          `📉 24ч: ${change24h.toFixed(2)}%\n` +
          `🔗 [DexScreener](${dexUrl})`;

        await sendTelegram(message);

      } else {

        console.log(`No alerts for ${symbol}`);

      }
    }

    console.log("");
    console.log("Saving prices.json...");

    fs.writeFileSync(
      'prices.json',
      JSON.stringify(currentPrices, null, 2)
    );

    console.log("prices.json saved");

    console.log("");
    console.log("Sending final test message...");

    await sendTelegram(
      "✅ DEX bot finished successfully"
    );

    console.log("");
    console.log("==================================");
    console.log("BOT FINISHED SUCCESSFULLY");
    console.log("==================================");

  } catch (err) {

    console.error("");
    console.error("==================================");
    console.error("FATAL ERROR");
    console.error(err);
    console.error("==================================");

    try {

      await sendTelegram(
        `❌ BOT ERROR:\n${err.message}`
      );

    } catch (e) {

      console.error("Failed to send error to Telegram");

    }
  }
}

async function startBot() {

  console.log("==================================");
  console.log("DEX BOT 24/7 MODE STARTED");
  console.log("==================================");

  while (true) {

    try {

      console.log("");
      console.log("==================================");
      console.log("NEW CHECK CYCLE");
      console.log("TIME:", new Date().toISOString());
      console.log("==================================");

      await main();

      console.log("");
      console.log("Cycle completed successfully");

    } catch (err) {

      console.error("");
      console.error("CYCLE ERROR:");
      console.error(err);

    }

    console.log("");
    console.log("Waiting 60 seconds before next cycle...");

    await new Promise(resolve =>
      setTimeout(resolve, 60000)
    );
  }
}

startBot();