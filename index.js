const currentCount = await watchlistCollection.countDocuments({ ownerId: chatId });
      const user = await usersCollection.findOne({ _id: chatId });
      const limit = user?.maxTokens ?? 20;
      if (currentCount >= limit) {
        await sendTelegram(chatId, `❌ Лимит ${limit} токенов достигнут. Удалите некоторые токены перед добавлением новых.`);
        return;
      }
      session.pendingData = { newTokenInfo: info };
      session.state = 'awaiting_add_threshold';
      await sendTelegram(
        chatId,
        `Найден токен: <b>${escapeHtml(info.name.toUpperCase())}</b> (${escapeHtml(info.chain)})\n` +
          `Введите процент изменения для оповещения (например, 10):`
      );
      return;
    }
    if (state === 'awaiting_add_threshold') {
      const { newTokenInfo } = session.pendingData ?? {};
      const percent = parseFloat(text);
      if (isNaN(percent) || percent <= 0) {
        await sendTelegram(chatId, '❌ Пожалуйста, введите положительное число (процент).');
        return;
      }
      await addWatchlistItem(
        chatId,
        newTokenInfo.chain,
        newTokenInfo.address,
        newTokenInfo.name,
        percent
      );
      // needRestart = true; // removed
      await sendTelegram(
        chatId,
        `✅ Токен <b>${escapeHtml(newTokenInfo.name.toUpperCase())}</b> добавлен с порогом ${percent}%.`
      );
      session.state = null;
      session.pendingData = {};
      return;
    }
    if (text === '/list') {
      const userList = await getUserWatchlist(chatId);
      if (userList.length === 0) {
        await sendTelegram(chatId, '📭 Ваш список отслеживания пуст.');
        return;
      }
      let msg = '<b>📋 Ваш список отслеживаемых токенов:</b>\n';
      userList.forEach((item, idx) => {
        msg += `${idx + 1}. <b>${escapeHtml(item.name.toUpperCase())}</b> (${escapeHtml(item.chain)}) – ${item.changeAlert}%\n`;
      });
      await sendTelegram(chatId, msg);
      return;
    }
    if (text === '/change') {
      const userList = await getUserWatchlist(chatId);
      if (userList.length === 0) {
        await sendTelegram(chatId, '📭 Ваш список отслеживания пуст. Сначала добавьте токены через /add.');
        return;
      }
      let msg = '<b>Выберите токен для изменения порога:</b>\n';
      userList.forEach((item, idx) => {
        msg += `${idx + 1}. <b>${escapeHtml(item.name.toUpperCase())}</b> (${escapeHtml(item.chain)}) – текущий ${item.changeAlert}%\n`;
      });
      session.state = 'awaiting_change_select';
      session.pendingData = {};
      await sendTelegram(chatId, msg);
      return;
    }
    if (text === '/change_all') {
      const userList = await getUserWatchlist(chatId);
      if (userList.length === 0) {
        await sendTelegram(chatId, '📭 Ваш список отслеживания пуст. Сначала добавьте токены через /add.');
        return;
      }
      session.state = 'awaiting_change_all_value';
      session.pendingData = {};
      await sendTelegram(chatId, 'Введите процент изменения, который будет установлен для всех ваших токенов:');
      return;
    }

    // Если ничего не подошло – просто игнорируем (можно отправить напоминание о /help)
  } catch (err) {
    console.error('Internal error:', err);
    await sendTelegram(msg.chat.id.toString(), '⚠️ Произошла ошибка. Попробуйте позже.');
  }
}

// ---------- Планировщик циклов с интервалом 20 секунд ----------
let offset = 0; // for getUpdates

async function scheduleNext() {
  if (shuttingDown) return;
  await runCycle();
  setTimeout(scheduleNext, CYCLE_INTERVAL_MS);
}

// ---------- Long Polling со встроенным fetch и таймаутом ----------
async function startPolling() {
  console.log('🤖 Long polling started');
  while (!shuttingDown) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`${TELEGRAM_API}/getUpdates?offset=${offset}&timeout=10`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (typeof data === 'object' && data !== null && data.ok && data.result.length > 0) {
        for (const upd of data.result) {
          offset = upd.update_id + 1;
          if (upd.message) await handleMessage(upd.message);
        }
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        console.log('Polling timeout, restarting...');
      } else {
        console.error('Polling error:', e);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }
  console.log('Long polling остановлен (shutdown)');
}

// ---------- Graceful shutdown ----------
function gracefulShutdown() {
  console.log('Получен сигнал завершения, ожидаем завершения текущего цикла...');
  shuttingDown = true;
  const forceExitTimeout = setTimeout(() => {
    console.error('Принудительный выход по таймауту');
    process.exit(0);
  }, 15000);
  const checkInterval = setInterval(() => {
    if (!isChecking) {
      clearTimeout(forceExitTimeout);
      clearInterval(checkInterval);
      console.log('Цикл завершён, выход');
      process.exit(0);
    }
  }, 200);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// ---------- Процесс-level обработчики для предотвращения крашей ----------
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

// ---------- Старт ----------
(async () => {
  await connectToMongo();
  scheduleNext();
  startPolling();
})();