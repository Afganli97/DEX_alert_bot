// Разделитель логов при запуске бота
console.log("==================================");

// Сообщение о старте бота
console.log("DEX BOT STARTED");

// Вывод текущего времени запуска
console.log("TIME:", new Date().toISOString());

// Разделитель логов
console.log("==================================");

// Подключение библиотеки для HTTP-запросов
const fetch = require('node-fetch');

// Подключение модуля для работы с файлами
const fs = require('fs');

// Подключение Express сервера
const express = require('express');

// Создание Express приложения
const app = express();

// Подключение AbortController для timeout HTTP-запросов
const AbortController = global.AbortController;

// Получение Telegram токена из переменных окружения
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

// Получение ID чата Telegram из переменных окружения
const CHAT_ID = process.env.CHAT_ID;

// Подключение списка токенов из отдельного файла
const tokens = require('./tokens');

// Флаг активного цикла проверки
let isChecking = false;

// Healthcheck endpoint для Render
app.get('/', (req, res) => {

  // Ответ Render о том что бот жив
  res.send('DEX BOT IS RUNNING');

});

// Функция отправки сообщения в Telegram
async function sendTelegram(message) {

  // Формирование URL Telegram API
  const url =
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

  try {

    // Лог отправки уведомления
    console.log("Sending Telegram alert...");

    // Отправка POST-запроса в Telegram API
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        // Указание JSON формата запроса
        'Content-Type': 'application/json'
      },
      // Тело запроса
      body: JSON.stringify({
        // ID Telegram чата
        chat_id: CHAT_ID,

        // Текст сообщения
        text: message,

        // Использование Markdown форматирования
        parse_mode: 'Markdown',

        // Отключение предпросмотра ссылок
        disable_web_page_preview: true
      })
    });

    // Преобразование ответа Telegram API в JSON
    const data = await response.json();

    // Проверка успешности запроса
    if (!data.ok) {

      // Вывод ошибки Telegram API
      console.error("Telegram API error");

      // Вывод полного ответа Telegram API
      console.error(JSON.stringify(data, null, 2));

    } else {

      // Лог успешной отправки уведомления
      console.log("Telegram alert sent");

    }

  } catch (err) {

    // Лог ошибки Telegram
    console.error("TELEGRAM ERROR");

    // Вывод объекта ошибки
    console.error(err);

  }
}

// Функция проверки цены токена
async function checkToken(token) {

  try {

    // Разделитель логов
    console.log("----------------------------------");

    // Лог проверки токена
    console.log(`Checking ${token.name}`);

    // Формирование URL запроса к DexScreener API
    const url =
      `https://api.dexscreener.com/latest/dex/tokens/${token.address}`;

    // Создание контроллера отмены HTTP-запроса
    const controller = new AbortController();

    // Таймер принудительной остановки запроса через 15 секунд
    const timeout = setTimeout(() => {

      // Принудительная отмена зависшего запроса
      controller.abort();

    }, 15000);

    // Переменная HTTP ответа
    let res;

    try {

      // Выполнение HTTP-запроса с timeout-защитой
      res = await fetch(url, {

        // Подключение AbortController к запросу
        signal: controller.signal

      });

    } finally {

      // Очистка timeout в любом случае
      clearTimeout(timeout);

    }

    // Проверка успешности HTTP ответа
    if (!res.ok) {

      // Лог HTTP ошибки
      console.log(
        `${token.name}: HTTP ${res.status}`
      );

      return null;
    }

    // Вывод HTTP статуса ответа
    console.log(`DexScreener status: ${res.status}`);

    // Преобразование ответа API в JSON
    const data = await res.json();

    // Получение массива торговых пар
    const pairs = data?.pairs;

    // Проверка наличия торговых пар
    if (!pairs || pairs.length === 0) {

      // Лог отсутствия торговых пар
      console.log(`${token.name}: no pairs`);

      return null;
    }

    // Сортировка пар по ликвидности и выбор самой ликвидной
    const pair = pairs.sort((a, b) =>
      (b.liquidity?.usd || 0) -
      (a.liquidity?.usd || 0)
    )[0];

    // Получение цены токена
    const price = parseFloat(pair.priceUsd || 0);

    // Проверка корректности цены
    if (!price || price <= 0) {

      // Лог некорректной цены
      console.log(`${token.name}: invalid price`);

      return null;
    }

    // Получение символа токена
    const symbol =
      pair.baseToken?.symbol || token.name;

    // Вывод текущей цены токена
    console.log(`${symbol}: $${price}`);

    // Возврат данных токена
    return {
      token,
      price,
      pair,
      symbol
    };

  } catch (err) {

    // Лог ошибки проверки токена
    console.error(`TOKEN ERROR: ${token.name}`);

    // Вывод объекта ошибки
    console.error(err);

    return null;
  }
}

// Функция форматирования цены
function formatPrice(price) {

  // Для очень маленьких значений используется экспоненциальный формат
  if (price < 0.0001) {
    return price.toExponential(3);
  }

  // Для значений меньше 1 используется precision
  if (price < 1) {
    return price.toPrecision(4);
  }

  // Для остальных значений используется fixed
  return price.toFixed(4);
}

// Главная функция цикла проверки
async function main() {

  try {

    // Проверка уже активного цикла
    if (isChecking) {

      // Лог пропуска нового цикла
      console.log("Previous cycle still running");

      return;
    }

    // Блокировка запуска нового цикла
    isChecking = true;

    // Пустая строка для читаемости логов
    console.log("");

    // Разделитель нового цикла
    console.log("==================================");

    // Лог нового цикла проверки
    console.log("NEW CHECK CYCLE");

    // Вывод времени начала цикла
    console.log(new Date().toISOString());

    // Разделитель логов
    console.log("==================================");

    // Проверка наличия Telegram токена
    if (!TELEGRAM_TOKEN) {
      throw new Error("Missing TELEGRAM_TOKEN");
    }

    // Проверка наличия ID чата
    if (!CHAT_ID) {
      throw new Error("Missing CHAT_ID");
    }

    // Объект для хранения anchor-цен
    let alertPrices = {};

    try {

      // Проверка существования файла с ценами
      if (fs.existsSync('prices.json')) {

        // Загрузка сохранённых цен из файла
        alertPrices = JSON.parse(
          fs.readFileSync('prices.json', 'utf8')
        );

        // Лог успешной загрузки
        console.log("Loaded alert anchor prices");

      } else {

        // Лог отсутствия файла
        console.log("prices.json not found");

        // Лог создания базовых цен
        console.log("Creating first baseline");

      }

    } catch (err) {

      // Лог ошибки загрузки файла
      console.error("prices.json load error");

      // Вывод объекта ошибки
      console.error(err);

    }

    // Перебор всех токенов
    for (const token of tokens) {

      // Проверка текущего токена
      const result = await checkToken(token);

      // Задержка между запросами
      await new Promise(r =>
        setTimeout(r, 3000)
      );

      // Пропуск токена при ошибке
      if (!result) {
        continue;
      }

      // Деструктуризация результата
      const {
        price,
        pair,
        symbol
      } = result;

      // Использование адреса токена как ключа
      const key = token.address;

      // ПЕРВЫЙ ЗАПУСК
      if (alertPrices[key] === undefined) {

        // Сохранение первой цены как anchor-price
        alertPrices[key] = price;

        // Лог сохранения первой anchor-цены
        console.log(
          `${symbol}: first baseline created at $${price}`
        );

        continue;
      }

      // Получение предыдущей anchor-цены
      const anchorPrice =
        alertPrices[key];

      // Расчёт процентного изменения цены
      const changePct =
        ((price - anchorPrice) / anchorPrice) * 100;

      // Вывод процента изменения
      console.log(
        `${symbol}: ${changePct.toFixed(2)}% from last alert`
      );

      // Проверка превышения порога изменения цены
      if (
        Math.abs(changePct) >= token.changeAlert
      ) {

        // Выбор эмодзи направления движения цены (вверх или вниз)
        const direction =
          changePct > 0 ? '📈' : '📉';

        // Добавление плюса для положительного значения
        const sign =
          changePct > 0 ? '+' : '';

        // Формирование короткого текста уведомления: эмодзи, название, изменение, цена
        const message =
          `${direction} *${symbol}* ${sign}${changePct.toFixed(2)}%\n` +
          `$${formatPrice(price)}`;

        // Отправка уведомления в Telegram
        await sendTelegram(message);

        // ОБНОВЛЯЕМ ЯКОРЬ ТОЛЬКО ПОСЛЕ ALERT
        alertPrices[key] = price;

        // Лог обновления anchor-цены
        console.log(
          `${symbol}: alert anchor updated`
        );
      }
    }

    // Сохранение обновлённых цен в файл
    fs.writeFileSync(
      'prices.json',
      JSON.stringify(alertPrices, null, 2)
    );

    // Лог успешного обновления файла
    console.log("prices.json updated");

  } catch (err) {

    // Лог критической ошибки
    console.error("FATAL ERROR");

    // Вывод объекта ошибки
    console.error(err);

    try {

      // Попытка отправить сообщение об ошибке в Telegram
      await sendTelegram(
        `❌ BOT ERROR\n${err.message}`
      );

    } catch (e) {

      // Лог ошибки отправки сообщения об ошибке
      console.error("Telegram error send failed");

    }
  } finally {

    // Снятие блокировки цикла
    isChecking = false;

  }
}

// Получение порта Render
const PORT = process.env.PORT || 3000;

// Запуск HTTP сервера
app.listen(PORT, () => {

  // Лог запуска сервера
  console.log(`Web server running on port ${PORT}`);

});

// Первый запуск проверки
main();

// Запуск проверки каждые 60 секунд
setInterval(() => {

  // Запуск основного цикла проверки
  main();

}, 120000);