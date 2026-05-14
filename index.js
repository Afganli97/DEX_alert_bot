console.log("==================================");
console.log("DEX BOT STARTED");
console.log("TIME:", new Date().toISOString());
console.log("==================================");

const fetch = require('node-fetch');
const fs = require('fs');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

const tokens = require('./tokens');

async function sendTelegram(message) {

  const url =
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

  try {

    console.log("Sending Telegram alert...");

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

    if (!data.ok) {

      console.error("Telegram API error:");
      console.error(JSON.stringify(data, null, 2));

    } else {

      console.log("Telegram alert sent");

    }

  } catch (err) {

    console.error("TELEGRAM ERROR");
    console.error(err);

  }
}

async function checkToken(token) {

  try {

    console.log("----------------------------------");
    console.log(`Checking ${token.name}`);

    const url =
      `https://api.dexscreener.com/latest/dex/tokens/${token.address}`;

    const res = await fetch(url);

    console.log(`DexScreener status: ${res.status}`);

    const data = await res.json();

    const pairs = data?.pairs;

    if (!pairs || pairs.length === 0) {

      console.log(`${token.name}: no pairs`);

      return null;
    }

    const pair = pairs.sort((a, b) =>
      (b.liquidity?.usd || 0) -
      (a.liquidity?.usd || 0)
    )[0];

    const price = parseFloat(pair.priceUsd || 0);

    if (!price || price <= 0) {

      console.log(`${token.name}: invalid price`);

      return null;
    }

    const symbol =
      pair.baseToken?.symbol || token.name;

    console.log(`${symbol}: $${price}`);

    return {
      token,
      price,
      pair,
      symbol
    };

  } catch (err) {

    console.error(`TOKEN ERROR: ${token.name}`);
    console.error(err);

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

    console.log("");
    console.log("==================================");
    console.log("NEW CHECK CYCLE");
    console.log(new Date().toISOString());
    console.log("==================================");

    if (!TELEGRAM_TOKEN) {
      throw new Error("Missing TELEGRAM_TOKEN");
    }

    if (!CHAT_ID) {
      throw new Error("Missing CHAT_ID");
    }

    let alertPrices = {};

    try {

      if (fs.existsSync('prices.json')) {

        alertPrices = JSON.parse(
          fs.readFileSync('prices.json', 'utf8')
        );

        console.log("Loaded alert anchor prices");

      } else {

        console.log("prices.json not found");
        console.log("Creating first baseline");

      }

    } catch (err) {

      console.error("prices.json load error");
      console.error(err);

    }

    for (const token of tokens) {

      const result = await checkToken(token);

      await new Promise(r =>
        setTimeout(r, 1000)
      );

      if (!result) {
        continue;
      }

      const {
        price,
        pair,
        symbol
      } = result;

      const key = token.address;

      // ПЕРВЫЙ ЗАПУСК
      if (alertPrices[key] === undefined) {

        alertPrices[key] = price;

        console.log(
          `${symbol}: baseline saved at $${price}`
        );

        continue;
      }

      const anchorPrice =
        alertPrices[key];

      const changePct =
        ((price - anchorPrice) / anchorPrice) * 100;

      console.log(
        `${symbol}: ${changePct.toFixed(2)}% from last alert`
      );

      if (
        Math.abs(changePct) >= token.changeAlert
      ) {

        const direction =
          changePct > 0 ? '📈' : '📉';

        const sign =
          changePct > 0 ? '+' : '';

        const volume24h =
          pair.volume?.h24 || 0;

        const liquidity =
          pair.liquidity?.usd || 0;

        const change24h =
          parseFloat(pair.priceChange?.h24 || 0);

        const dexUrl =
          pair.url || '';

        const chain =
          token.chain.toUpperCase();

        const message =
          `⚠️ *${symbol}* (${chain})\n\n` +
          `${direction} Изменение: *${sign}${changePct.toFixed(2)}%*\n\n` +
          `📍 Последний alert-price: $${formatPrice(anchorPrice)}\n` +
          `💰 Текущая цена: $${formatPrice(price)}\n\n` +
          `📊 Объём 24ч: $${Math.round(volume24h).toLocaleString()}\n` +
          `💧 Ликвидность: $${Math.round(liquidity).toLocaleString()}\n` +
          `📉 24ч: ${change24h.toFixed(2)}%\n` +
          `🔗 [DexScreener](${dexUrl})`;

        await sendTelegram(message);

        // ОБНОВЛЯЕМ ЯКОРЬ ТОЛЬКО ПОСЛЕ ALERT
        alertPrices[key] = price;

        console.log(
          `${symbol}: alert anchor updated`
        );
      }
    }

    fs.writeFileSync(
      'prices.json',
      JSON.stringify(alertPrices, null, 2)
    );

    console.log("prices.json updated");

  } catch (err) {

    console.error("FATAL ERROR");
    console.error(err);

    try {

      await sendTelegram(
        `❌ BOT ERROR\n${err.message}`
      );

    } catch (e) {

      console.error("Telegram error send failed");

    }
  }
}

async function startBot() {

  console.log("");
  console.log("==================================");
  console.log("DEX BOT 24/7 MODE");
  console.log("==================================");

  while (true) {

    try {

      await main();

      console.log("");
      console.log("Cycle completed");

    } catch (err) {

      console.error("CYCLE ERROR");
      console.error(err);

    }

    console.log("");
    console.log("Waiting 60 seconds...");

    await new Promise(resolve =>
      setTimeout(resolve, 60000)
    );
  }
}

startBot();