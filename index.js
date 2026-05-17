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

// Подключение middleware для парсинга JSON в теле запросов Telegram
app.use(express.json());

// Подключение AbortController для timeout HTTP-запросов
const AbortController = global.AbortController;

// Получение Telegram токена из переменных окружения
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

// Получение ID чата Telegram из переменных окружения
const CHAT_ID = process.env.CHAT_ID;

// Путь к файлу с динамическим списком токенов
const TOKENS_FILE = 'tokens_dynamic.json';

// Флаг активного цикла проверки
let isChecking = false;

// Состояние ожидания ввода от пользователя
// null = не ждём ничего
// 'address' = ждём адрес контракта
// 'percent' = ждём процент изменения
let userState = null;

// Временное хранение адреса пока пользователь не ввёл процент
let pendingAddress = null;

// Временное хранение данных токена найденных на DexScreener
let pendingTokenData = null;

// Загрузка динамического списка токенов из файла
function loadDynamicTokens() {

  try {

    // Проверка существования файла с динамическими токенами
    if (fs.existsSync(TOKENS_FILE)) {

      // Чтение и парсинг файла
      return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));

    }

  } catch (err) {

    // Лог ошибки загрузки динамических токенов
    console.error("Dynamic tokens load error:", err);

  }

  // Возврат пустого массива если файл не существует
  return [];
}

// Сохранение динамического списка токенов в файл
function saveDynamicTokens(tokens) {

  try {

    // Запись массива токенов в файл
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));

    // Лог успешного сохранения
    console.log("Dynamic tokens saved");

  } catch (err) {

    // Лог ошибки сохранения
    console.error("Dynamic tokens save error:", err);

  }
}

// Получение итогового списка токенов: статические + динамические
function getAllTokens() {

  // Загрузка статических токенов из tokens.js
  const staticTokens = require('./tokens');

  // Загрузка динамических токенов из файла
  const dynamicTokens = loadDynamicTokens();

  // Объединение обоих массивов
  return [...staticTokens, ...dynamicTokens];
}

// Healthcheck endpoint для Render
app.get('/', (req, res) => {

  // Ответ Render о том что бот жив
  res.send('DEX BOT IS RUNNING');

});

// Webhook endpoint для приёма сообщений от Telegram
app.post('/webhook', async (req, res) => {

  // Немедленный ответ Telegram чтобы не было таймаута
  res.sendStatus(200);

  try {

    // Получение объекта сообщения из тела запроса
    const message = req.body?.message;

    // Проверка наличия сообщения и текста
    if (!message || !message.text) return;

    // Получение текста сообщения и удаление лишних пробелов
    const text = message.text.trim();

    // Получение ID чата отправителя
    const chatId = message.chat.id.toString();

    // Проверка что сообщение пришло от авторизованного чата
    if (chatId !== CHAT_ID) {

      // Лог попытки несанкционированного доступа
      console.log(`Unauthorized access attempt from chat ${chatId}`);
      return;

    }

    // Обработка команды /add — начало добавления токена
    if (text === '/add') {

      // Установка состояния ожидания адреса
      userState = 'address';

      // Сброс временных данных
      pendingAddress = null;
      pendingTokenData = null;

      // Отправка инструкции пользователю
      await sendTelegram('Введи адрес контракта токена:');
      return;

    }

    // Обработка команды /list — показать список отслеживаемых токенов
    if (text === '/list') {

      // Получение всех токенов
      const allTokens = getAllTokens();

      // Проверка наличия токенов
      if (allTokens.length === 0) {

        await sendTelegram('Список токенов пуст.');
        return;

      }

      // Формирование строки со списком токенов
      const list = allTokens.map((t, i) =>
        `${i + 1}. *${t.name.toUpperCase()}* (${t.chain})\n` +
        `Адрес: \`${t.address}\`\n` +
        `Алерт: ${t.changeAlert}%`
      ).join('\n\n');

      // Отправка списка
      await sendTelegram(`📋 *Отслеживаемые токены:*\n\n${list}`);
      return;

    }

    // Обработка команды /remove — удаление токена по адресу
    if (text.startsWith('/remove ')) {

      // Извлечение адреса из команды
      const addressToRemove = text.replace('/remove ', '').trim();

      // Загрузка динамических токенов
      const dynamicTokens = loadDynamicTokens();

      // Поиск токена в динамическом списке (только динамические можно удалить)
      const index = dynamicTokens.findIndex(
        t => t.address.toLowerCase() === addressToRemove.toLowerCase()
      );

      // Проверка что токен найден
      if (index === -1) {

        await sendTelegram(
          '❌ Токен не найден в динамическом списке.\n' +
          'Статические токены из tokens.js удалить нельзя.'
        );
        return;

      }

      // Сохранение имени удаляемого токена для уведомления
      const removedName = dynamicTokens[index].name.toUpperCase();

      // Удаление токена из массива
      dynamicTokens.splice(index, 1);

      // Сохранение обновлённого списка
      saveDynamicTokens(dynamicTokens);

      // Уведомление об успешном удалении
      await sendTelegram(`✅ Токен *${removedName}* удалён из отслеживания.`);
      return;

    }

    // Обработка команды /cancel — отмена текущего действия
    if (text === '/cancel') {

      // Сброс состояния
      userState = null;
      pendingAddress = null;
      pendingTokenData = null;

      await sendTelegram('Действие отменено.');
      return;

    }

    // Обработка команды /help — список команд
    if (text === '/help') {

      await sendTelegram(
        '📖 *Команды бота:*\n\n' +
        '/add — добавить токен для отслеживания\n' +
        '/remove [адрес] — удалить токен\n' +
        '/list — список всех токенов\n' +
        '/cancel — отменить текущее действие\n' +
        '/help — эта справка'
      );
      return;

    }

    // Обработка состояния ожидания адреса контракта
    if (userState === 'address') {

      // Валидация адреса: должен начинаться с 0x и содержать 42 символа
      const isValidAddress = /^0x[0-9a-fA-F]{40}$/.test(text);

      // Проверка корректности адреса
      if (!isValidAddress) {

        await sendTelegram(
          '❌ Некорректный адрес контракта.\n\n' +
          'Адрес должен начинаться с *0x* и содержать 42 символа.\n' +
          'Попробуй ещё раз или введи /cancel для отмены.'
        );
        return;

      }

      // Проверка что токен ещё не отслеживается
      const allTokens = getAllTokens();
      const alreadyExists = allTokens.find(
        t => t.address.toLowerCase() === text.toLowerCase()
      );

      // Уведомление если токен уже есть в списке
      if (alreadyExists) {

        await sendTelegram(
          `❌ Токен с адресом \`${text}\` уже отслеживается как *${alreadyExists.name.toUpperCase()}*.`
        );

        // Сброс состояния
        userState = null;
        return;

      }

      // Уведомление о поиске токена
      await sendTelegram('🔍 Ищу токен на DexScreener...');

      // Запрос к DexScreener для получения данных токена
      let tokenInfo = null;

      try {

        // Формирование URL запроса
        const url = `https://api.dexscreener.com/latest/dex/tokens/${text}`;

        // Создание контроллера отмены запроса
        const controller = new AbortController();

        // Таймер отмены запроса через 15 секунд
        const timeout = setTimeout(() => controller.abort(), 15000);

        // Выполнение запроса
        const dexRes = await fetch(url, { signal: controller.signal });

        // Очистка таймера
        clearTimeout(timeout);

        // Парсинг ответа
        const dexData = await dexRes.json();

        // Получение массива пар
        const pairs = dexData?.pairs;

        // Проверка наличия пар
        if (pairs && pairs.length > 0) {

          // Выбор самой ликвидной пары
          const bestPair = pairs.sort((a, b) =>
            (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
          )[0];

          // Сохранение данных токена
          tokenInfo = {
            name: (bestPair.baseToken?.symbol || 'unknown').toLowerCase(),
            chain: bestPair.chainId || 'unknown',
            address: text
          };

        }

      } catch (err) {

        // Лог ошибки запроса к DexScreener
        console.error("DexScreener lookup error:", err);

      }

      // Проверка что токен найден на DexScreener
      if (!tokenInfo) {

        await sendTelegram(
          '❌ Токен не найден на DexScreener.\n\n' +
          'Проверь адрес контракта и попробуй ещё раз или введи /cancel.'
        );
        return;

      }

      // Сохранение найденных данных токена во временное хранилище
      pendingTokenData = tokenInfo;

      // Сохранение адреса во временное хранилище
      pendingAddress = text;

      // Переход к следующему шагу — ожидание процента
      userState = 'percent';

      // Запрос процента изменения у пользователя
      await sendTelegram(
        `✅ Токен найден: *${tokenInfo.name.toUpperCase()}* (${tokenInfo.chain})\n\n` +
        'Введи процент изменения цены для алерта (только цифра, например: *10*)'
      );
      return;

    }

    // Обработка состояния ожидания процента изменения
    if (userState === 'percent') {

      // Парсинг введённого числа
      const percent = parseFloat(text);

      // Валидация: должно быть числом больше 0 и не больше 100
      if (isNaN(percent) || percent <= 0 || percent > 100) {

        await sendTelegram(
          '❌ Некорректное значение.\n\n' +
          'Введи число от *1* до *100* (например: 10)\n' +
          'Или введи /cancel для отмены.'
        );
        return;

      }

      // Формирование объекта нового токена
      const newToken = {
        name: pendingTokenData.name,
        chain: pendingTokenData.chain,
        address: pendingAddress,
        changeAlert: percent
      };

      // Загрузка текущего динамического списка
      const dynamicTokens = loadDynamicTokens();

      // Добавление нового токена в список
      dynamicTokens.push(newToken);

      // Сохранение обновлённого списка
      saveDynamicTokens(dynamicTokens);

      // Сброс состояния после успешного добавления
      userState = null;
      pendingAddress = null;
      pendingTokenData = null;

      // Уведомление об успешном добавлении
      await sendTelegram(
        `✅ Токен *${newToken.name.toUpperCase()}* добавлен!\n\n` +
        `Сеть: ${newToken.chain}\n` +
        `Алерт при изменении: *${newToken.changeAlert}%*`
      );
      return;

    }

  } catch (err) {

    // Лог ошибки обработки webhook
    console.error("Webhook handler error:", err);

  }
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

    // Получение актуального списка всех токенов на момент цикла
    const allTokens = getAllTokens();

    // Перебор всех токенов
    for (const token of allTokens) {

      // Проверка текущего токена
      const result = await checkToken(token);

      // Задержка между запросами
      await new Promise(r =>
        setTimeout(r, 5000)
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
          changePct > 0 ? '🚀' : '🔻';

        // Добавление плюса для положительного значения
        const sign =
          changePct > 0 ? '+' : '';

        // Получение ссылки DexScreener для названия токена
        const dexUrl =
          pair.url || '';

        // Формирование сообщения: токен как ссылка (синий цвет), стрелка, изменение, цена
        const message =
          `${direction} [${symbol}](${dexUrl}) ${sign}${changePct.toFixed(2)}%\n` +
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

  // Регистрация webhook в Telegram после старта сервера
  registerWebhook();

});

// Функция регистрации webhook в Telegram
async function registerWebhook() {

  try {

    // Получение публичного URL сервиса из переменных окружения
    const RENDER_URL = process.env.RENDER_URL;

    // Проверка наличия URL
    if (!RENDER_URL) {

      // Лог предупреждения об отсутствии URL
      console.log("RENDER_URL not set - webhook not registered");
      return;

    }

    // Формирование полного URL webhook
    const webhookUrl = `${RENDER_URL}/webhook`;

    // Формирование URL запроса к Telegram API
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook`;

    // Отправка запроса на регистрацию webhook
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl })
    });

    // Парсинг ответа
    const data = await res.json();

    // Проверка успешности регистрации
    if (data.ok) {

      // Лог успешной регистрации
      console.log(`Webhook registered: ${webhookUrl}`);

    } else {

      // Лог ошибки регистрации
      console.error("Webhook registration failed:", JSON.stringify(data));

    }

  } catch (err) {

    // Лог ошибки регистрации webhook
    console.error("Webhook registration error:", err);

  }
}

// Первый запуск проверки
main();

// Запуск проверки каждые 120 секунд
setInterval(() => {

  // Запуск основного цикла проверки
  main();

}, 180000);