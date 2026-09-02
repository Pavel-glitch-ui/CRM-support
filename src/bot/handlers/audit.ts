import { Context } from 'telegraf';
import { state } from '../../state';
import { Keyboards } from '../keyboards';
import { Bitrix24Client } from '../../crm/bitrix24';
import { AmoCrmClient } from '../../crm/amocrm';
import { aggregateBitrixMetrics, aggregateAmoMetrics } from '../../crm/aggregator';
import { performBusinessAudit, generateExecutiveSummary } from '../../ai/agent';
import { searchWeb } from '../../ai/tools/search';
import { BusinessMetrics } from '../../types';
import { sendSafeText, sendAuditTxtFile, sendAuditPdfFile, sendAuditMdFile } from '../../utils/telegram';
import { generateAuditPdf } from '../../services/pdf';
import { generateAuditMarkdown } from '../../services/markdown';

/**
 * 1. Получение экспресс-метрик по 50 последним измененным сделкам
 */
async function fetchRecentMetrics(chatId: string | number): Promise<BusinessMetrics | null> {
  const session = state.get(chatId);

  if (!session.crmType || !session.credentials) {
    return session.metricsCache || null;
  }

  try {
    if (session.crmType === 'bitrix24') {
      const creds = session.credentials as { webhookUrl: string };
      const client = new Bitrix24Client(creds.webhookUrl);
      const rawData = await client.fetchRecentData(50);
      const metrics = aggregateBitrixMetrics(rawData, creds.webhookUrl, 'recent');
      state.setMetrics(chatId, metrics);
      return metrics;
    } else if (session.crmType === 'amocrm') {
      const creds = session.credentials as { domain: string; token: string };
      const client = new AmoCrmClient(creds.domain, creds.token);
      const rawData = await client.fetchRecentData(50);
      const metrics = aggregateAmoMetrics(rawData, creds.domain, 'recent');
      state.setMetrics(chatId, metrics);
      return metrics;
    }
  } catch (error: any) {
    console.error(`[Recent Metrics Fetch] Ошибка сбора данных:`, error.message);
  }

  return session.metricsCache || null;
}

/**
 * 2. Потоковая выгрузка всей базы чанками с пагинацией
 */
async function fetchFullChunkedMetrics(
  chatId: string | number,
  onProgress?: (loadedCount: number, totalCount: number | null, chunkIndex: number) => Promise<void> | void
): Promise<BusinessMetrics | null> {
  const session = state.get(chatId);

  if (!session.crmType || !session.credentials) {
    return session.metricsCache || null;
  }

  try {
    if (session.crmType === 'bitrix24') {
      const creds = session.credentials as { webhookUrl: string };
      const client = new Bitrix24Client(creds.webhookUrl);
      const rawData = await client.fetchChunkedData(onProgress, 500);
      const metrics = aggregateBitrixMetrics(rawData, creds.webhookUrl, 'full');
      state.setMetrics(chatId, metrics);
      return metrics;
    } else if (session.crmType === 'amocrm') {
      const creds = session.credentials as { domain: string; token: string };
      const client = new AmoCrmClient(creds.domain, creds.token);
      const rawData = await client.fetchChunkedData(onProgress, 500);
      const metrics = aggregateAmoMetrics(rawData, creds.domain, 'full');
      state.setMetrics(chatId, metrics);
      return metrics;
    }
  } catch (error: any) {
    console.error(`[Full Stream Fetch] Ошибка потокового сбора:`, error.message);
  }

  return session.metricsCache || null;
}

/**
 * РЕЖИМ 1: Экспресс-аудит (последние 50 активных сделок)
 */
export async function handleRecentAudit(ctx: Context) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const session = state.get(chatId);
  if (!state.isConnected(chatId) && !session.metricsCache) {
    await ctx.reply(`⚠️ Сначала подключите вашу CRM или запустите демо-режим:`, Keyboards.chooseCrm);
    return;
  }

  const statusMsg = await ctx.reply(
    `⚡ *ИИ-Агент начинает экспресс-аудит...*\n\n` +
    `📥 Выгружаю 50 последних измененных сделок...\n` +
    `_Пожалуйста, подождите пару секунд..._`,
    { parse_mode: 'Markdown' }
  );

  try {
    const metrics = await fetchRecentMetrics(chatId);
    if (!metrics) {
      try {
        await ctx.telegram.deleteMessage(chatId, statusMsg.message_id);
      } catch (_) { }
      await ctx.reply(`❌ Не удалось получить данные из CRM. Проверьте права доступа.`, Keyboards.backToMenu);
      return;
    }

    try {
      await ctx.telegram.editMessageText(
        chatId,
        statusMsg.message_id,
        undefined,
        `⚡ *ИИ-Анализ текущего пульса продаж...*\n\n` +
        `📊 Обработано сделок: *${metrics.summary.totalDeals}*\n` +
        `🔍 Сверяю показатели с отраслевыми нормами рынка...\n\n` +
        `_🧠 Нейросеть генерирует аудит и верстает PDF... Пожалуйста, подождите ~10–20 секунд, ваш отчет уже в пути!_`,
        { parse_mode: 'Markdown' }
      );
    } catch (_) { }

    const auditResult = await performBusinessAudit(
      metrics,
      session.niche || 'B2B/B2C продажи и услуги',
      async () => {
        try {
          await ctx.telegram.editMessageText(
            chatId,
            statusMsg.message_id,
            undefined,
            `⚡ *ИИ-Агент формирует углубленный аудит...*\n\n` +
            `_Подготовка расчетов и верстка PDF..._`,
            { parse_mode: 'Markdown' }
          );
        } catch (_) { }
      }
    );

    let searchesNote = '';
    if (auditResult.searches && auditResult.searches.length > 0) {
      searchesNote = `\n\n🌐 *Использованные поисковые запросы по рынку:*\n` +
        auditResult.searches.map(s => `• _${s}_`).join('\n');
    }

    const fullReportText = auditResult.text + searchesNote;

    // 0. Сохраняем аудит в сессию для повторного быстрого экспорта
    state.setLastAuditReport(chatId, {
      text: fullReportText,
      searches: auditResult.searches || [],
      scope: 'recent',
      createdAt: new Date().toISOString(),
    });

    try {
      await ctx.telegram.editMessageText(
        chatId,
        statusMsg.message_id,
        undefined,
        `📄 *Подготовка полного отчета (.md) и резюме...*\n\n` +
        `_Почти готово! Прикрепляю документ и резюме..._`,
        { parse_mode: 'Markdown' }
      );
    } catch (_) { }

    // 1. Генерируем краткое Executive Summary для чата
    const executiveSummary = await generateExecutiveSummary(
      fullReportText,
      metrics,
      session.niche || 'Не указана'
    );

    // Очищаем статусное сообщение прогресса
    try {
      await ctx.telegram.deleteMessage(chatId, statusMsg.message_id);
    } catch (_) { }

    // 2. Отправляем лаконичное Executive Summary в чат
    await sendSafeText(ctx, executiveSummary);

    // 3. Генерируем и прикрепляем полный брендированный .md документ (мгновенное открытие в Telegram)
    try {
      const mdContent = generateAuditMarkdown(metrics, fullReportText, session.niche, auditResult.searches);
      await sendAuditMdFile(
        ctx,
        mdContent,
        `CRM_Recent_Audit_${metrics.portalOrDomain || 'Report'}`,
        `⚡ *Полный отчет экспресс-аудита (.md)*\n\n_Файл открывается мгновенно в Telegram. Вы также можете скачать PDF-версию по кнопке ниже:_`,
        Keyboards.afterAuditMenu
      );
    } catch (mdErr: any) {
      console.warn('[Markdown Generation Warning] Ошибка генерации MD:', mdErr.message);
      await sendAuditTxtFile(
        ctx,
        fullReportText,
        `CRM_Recent_Audit_${metrics.portalOrDomain || 'Report'}`,
        `📋 *Полный экспресс-аудит (последние 50 сделок) прикреплен в файле выше.*\n\n_Задайте вопрос ИИ по отчету через кнопку ниже:_`,
        Keyboards.afterAuditMenu
      );
    }
  } catch (error: any) {
    console.error('[Recent Audit Error]', error);
    try {
      await ctx.telegram.deleteMessage(chatId, statusMsg.message_id);
    } catch (_) { }
    await ctx.reply(`⚠️ Произошла ошибка: ${error.message}`, Keyboards.backToMenu);
  }
}

/**
 * РЕЖИМ 2: Полный потоковый аудит всей базы (Chunked Streaming)
 */
export async function handleFullStreamAudit(ctx: Context) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const session = state.get(chatId);
  if (!state.isConnected(chatId) && !session.metricsCache) {
    await ctx.reply(`⚠️ Сначала подключите вашу CRM или запустите демо-режим:`, Keyboards.chooseCrm);
    return;
  }

  const statusMsg = await ctx.reply(
    `🚀 *Запуск потокового сбора всей базы CRM...*\n\n` +
    `📦 Инициализация пагинации...\n\n` +
    `_Пожалуйста, подождите..._`,
    { parse_mode: 'Markdown' }
  );

  try {
    const metrics = await fetchFullChunkedMetrics(
      chatId,
      async (loadedCount, totalCount, chunkIndex) => {
        try {
          const totalStr = totalCount ? ` из ~${totalCount}` : '';
          await ctx.telegram.editMessageText(
            chatId,
            statusMsg.message_id,
            undefined,
            `📥 *Потоковая выгрузка базы CRM...*\n\n` +
            `📦 Обработан чанк: *#${chunkIndex}*\n` +
            `📊 Загружено сделок: *${loadedCount}${totalStr}*\n\n` +
            `_Стриминг данных в аналитический модуль..._`,
            { parse_mode: 'Markdown' }
          );
        } catch (_) { }
      }
    );

    if (!metrics) {
      try {
        await ctx.telegram.deleteMessage(chatId, statusMsg.message_id);
      } catch (_) { }
      await ctx.reply(`❌ Не удалось выгрузить базу из CRM.`, Keyboards.backToMenu);
      return;
    }

    try {
      await ctx.telegram.editMessageText(
        chatId,
        statusMsg.message_id,
        undefined,
        `🧠 *ИИ-Агент проводит комплексный стратегический аудит...*\n\n` +
        `📊 Полный объем базы: *${metrics.summary.totalDeals} сделок*\n` +
        `🔍 Сверяю воронку с рыночными отраслевыми нормами...\n\n` +
        `_🧠 Генерация аналитики и верстка PDF-отчета... Пожалуйста, подождите ~15–25 секунд, ваш отчет уже в пути!_`,
        { parse_mode: 'Markdown' }
      );
    } catch (_) { }

    const auditResult = await performBusinessAudit(
      metrics,
      session.niche || 'B2B/B2C продажи и услуги',
      async () => {
        try {
          await ctx.telegram.editMessageText(
            chatId,
            statusMsg.message_id,
            undefined,
            `🧠 *ИИ-Анализ всей базы CRM...*\n\n` +
            `_Глубокий разбор воронки и верстка PDF-отчета..._`,
            { parse_mode: 'Markdown' }
          );
        } catch (_) { }
      }
    );

    let searchesNote = '';
    if (auditResult.searches && auditResult.searches.length > 0) {
      searchesNote = `\n\n🌐 *Использованные поисковые запросы по рынку:*\n` +
        auditResult.searches.map(s => `• _${s}_`).join('\n');
    }

    const fullReportText = auditResult.text + searchesNote;

    // 0. Сохраняем аудит в сессию для повторного быстрого экспорта
    state.setLastAuditReport(chatId, {
      text: fullReportText,
      searches: auditResult.searches || [],
      scope: 'full',
      createdAt: new Date().toISOString(),
    });

    try {
      await ctx.telegram.editMessageText(
        chatId,
        statusMsg.message_id,
        undefined,
        `📄 *Подготовка полного отчета (.md) всей базы и резюме...*\n\n` +
        `_Почти готово! Прикрепляю документ и резюме..._`,
        { parse_mode: 'Markdown' }
      );
    } catch (_) { }

    // 1. Генерируем краткое Executive Summary для чата
    const executiveSummary = await generateExecutiveSummary(
      fullReportText,
      metrics,
      session.niche || 'Не указана'
    );

    // Очищаем статусное сообщение прогресса
    try {
      await ctx.telegram.deleteMessage(chatId, statusMsg.message_id);
    } catch (_) { }

    // 2. Отправляем лаконичное Executive Summary в чат
    await sendSafeText(ctx, executiveSummary);

    // 3. Генерируем и прикрепляем брендированный .md документ всей базы
    try {
      const mdContent = generateAuditMarkdown(metrics, fullReportText, session.niche, auditResult.searches);
      await sendAuditMdFile(
        ctx,
        mdContent,
        `CRM_Full_Strategic_Audit_${metrics.portalOrDomain || 'Report'}`,
        `⚡ *Полный стратегический аудит всей базы (.md)*\n\n_Файл открывается мгновенно в Telegram. Вы также можете скачать PDF-версию по кнопке ниже:_`,
        Keyboards.afterAuditMenu
      );
    } catch (mdErr: any) {
      console.warn('[Markdown Generation Warning] Ошибка генерации MD:', mdErr.message);
      await sendAuditTxtFile(
        ctx,
        fullReportText,
        `CRM_Full_Strategic_Audit_${metrics.portalOrDomain || 'Report'}`,
        `📋 *Полный стратегический аудит всей базы прикреплен в файле выше.*\n\n_Задайте вопрос ИИ по отчету через кнопку ниже:_`,
        Keyboards.afterAuditMenu
      );
    }
  } catch (error: any) {
    console.error('[Full Stream Audit Error]', error);
    try {
      await ctx.telegram.deleteMessage(chatId, statusMsg.message_id);
    } catch (_) { }
    await ctx.reply(`⚠️ Произошла ошибка при анализе: ${error.message}`, Keyboards.backToMenu);
  }
}

/**
 * Экспресс-дашборд воронки (чистая математика)
 */
export async function handleDashboard(ctx: Context) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const session = state.get(chatId);
  const metrics = await fetchRecentMetrics(chatId);

  if (!metrics) {
    await ctx.reply(`⚠️ CRM не подключена:`, Keyboards.chooseCrm);
    return;
  }

  const { summary } = metrics;
  const isRecent = metrics.scope === 'recent';

  await ctx.reply(
    `📊 *ЭКСПРЕСС-ДАШБОРД ВОРОНКИ ПРОДАЖ (${isRecent ? 'ПОСЛЕДНИЕ 50 СДЕЛОК' : 'ВСЯ БАЗА'})*\n\n` +
    `🏢 Ниша: *${session.niche || 'Не указана'}*\n` +
    `🔗 CRM: *${metrics.crmType === 'bitrix24' ? 'Битрикс24' : 'amoCRM'}* (\`${metrics.portalOrDomain}\`)\n\n` +
    `📈 *Воронка сделок:*\n` +
    `• Всего сделок: *${summary.totalDeals}*\n` +
    `• ✅ Успешно: *${summary.wonDeals}* (Win Rate: *${summary.winRatePercent}%*)\n` +
    `• ❌ Проиграно: *${summary.lostDeals}*\n` +
    `• 🔄 В работе: *${summary.inProgressDeals}*\n\n` +
    `💰 *Финансы:*\n` +
    `• Фактическая выручка: *${summary.totalRevenue.toLocaleString('ru-RU')} ₽*\n` +
    `• Пайплайн (в работе): *${summary.pipelineValue.toLocaleString('ru-RU')} ₽*\n` +
    `• Средний чек: *${summary.averageCheck.toLocaleString('ru-RU')} ₽*\n\n` +
    `⚠️ *Риски:*\n` +
    `• Зависшие сделки (>14 дней): *${summary.stuckDealsCount}*\n` +
    `• Просроченные задачи: *${metrics.tasks.overdue} из ${metrics.tasks.total}* (*${metrics.tasks.overduePercent}%*)`,
    {
      parse_mode: 'Markdown',
      ...Keyboards.mainMenu(true),
    }
  );
}

/**
 * Аудит команды и менеджеров
 */
export async function handleManagers(ctx: Context) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const metrics = await fetchRecentMetrics(chatId);
  if (!metrics) {
    await ctx.reply(`⚠️ CRM не подключена:`, Keyboards.chooseCrm);
    return;
  }

  const managersList = metrics.managers.map((m, idx) => {
    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉';
    return (
      `${medal} *${m.name}*\n` +
      `   • Выручка: *${m.totalRevenue.toLocaleString('ru-RU')} ₽* (Сделок: ${m.dealsCount})\n` +
      `   • Win Rate: *${m.winRatePercent}%* (Выиграно: ${m.wonDealsCount}, Слито: ${m.lostDealsCount})\n` +
      `   • Задачи: Открыто ${m.openTasksCount}, Просрочено: *${m.overdueTasksCount}*`
    );
  }).join('\n\n') || 'Данные по сотрудникам не найдены.';

  await ctx.reply(
    `👥 *РЕЙТИНГ И АУДИТ МЕНЕДЖЕРОВ ПО ПРОДАЖАМ*\n\n` +
    `${managersList}\n\n` +
    `📌 *Общая дисциплина по задачам:*\n` +
    `Всего задач: *${metrics.tasks.total}* | Просрочено: *${metrics.tasks.overdue}* (*${metrics.tasks.overduePercent}%*)\n\n` +
    `_Совет: используйте «Задать вопрос ИИ-консультанту» для составления персонального регламента мотивации._`,
    {
      parse_mode: 'Markdown',
      ...Keyboards.mainMenu(true),
    }
  );
}

/**
 * Поиск рыночных бенчмарков
 */
export async function handleBenchmarks(ctx: Context) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const session = state.get(chatId);
  const niche = session.niche || 'b2b продажи и услуги';

  const searchingMsg = await ctx.reply(`🔍 *Ищу отраслевые бенчмарки в интернете по нише:* "${niche}"...`, { parse_mode: 'Markdown' });

  try {
    const query = `средняя конверсия воронки продаж ${niche} бенчмарки средний чек`;
    const results = await searchWeb(query, 3);

    const snippetsText = results.map(r =>
      `📌 *${r.title}*\n${r.snippet}`
    ).join('\n\n') || 'Информация по рынку агрегируется...';

    const responseText = `🌐 *ОТРАСЛЕВЫЕ БЕНЧМАРКИ ИЗ СЕТИ (${niche})*\n\n` +
      `${snippetsText}\n\n` +
      `💡 *Чтобы сравнить эти показатели с вашими цифрами, запустите «Полный аудит всей базы».*`;

    try {
      await ctx.telegram.editMessageText(
        chatId,
        searchingMsg.message_id,
        undefined,
        responseText,
        {
          parse_mode: 'Markdown',
          ...Keyboards.mainMenu(true),
        }
      );
    } catch (_) {
      await ctx.telegram.deleteMessage(chatId, searchingMsg.message_id);
      await ctx.reply(responseText, {
        parse_mode: 'Markdown',
        ...Keyboards.mainMenu(true),
      });
    }
  } catch (error: any) {
    try {
      await ctx.telegram.deleteMessage(chatId, searchingMsg.message_id);
    } catch (_) { }
    await ctx.reply(`⚠️ Ошибка поиска: ${error.message}`, Keyboards.mainMenu(true));
  }
}

/**
 * Обновление метрик
 */
export async function handleRefreshMetrics(ctx: Context) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  state.set(chatId, { metricsCache: null });
  await ctx.reply(`🔄 Метрики сброшены. Получаю свежие данные из CRM...`);
  await handleDashboard(ctx);
}

/**
 * Экспорт полных данных и аудита в формате .md по требованию пользователя
 */
export async function handleExportMarkdown(ctx: Context) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const session = state.get(chatId);
  const metrics = session.metricsCache || await fetchRecentMetrics(chatId);

  if (!metrics) {
    await ctx.reply(`⚠️ CRM не подключена или нет данных для экспорта:`, Keyboards.chooseCrm);
    return;
  }

  const waitMsg = await ctx.reply(`⚡ *Формирую файл .md с полными данными и аудитом...*`, { parse_mode: 'Markdown' });

  try {
    const reportText = session.lastAuditReport?.text || '';
    const searches = session.lastAuditReport?.searches || [];
    const mdContent = generateAuditMarkdown(metrics, reportText, session.niche, searches);

    try {
      await ctx.telegram.deleteMessage(chatId, waitMsg.message_id);
    } catch (_) {}

    await sendAuditMdFile(
      ctx,
      mdContent,
      `CRM_Full_Data_${metrics.portalOrDomain || 'Report'}`,
      `⚡ *Полные данные и аудит CRM в формате Markdown (.md)*\n\n_Файл открывается мгновенно в Telegram. Содержит сводку воронки, аудит менеджеров, точки потерь и чек-лист действий._`,
      Keyboards.afterAuditMenu
    );
  } catch (err: any) {
    console.error('[Export MD Error]', err);
    try {
      await ctx.telegram.deleteMessage(chatId, waitMsg.message_id);
    } catch (_) {}
    await ctx.reply(`⚠️ Ошибка при экспорте Markdown: ${err.message}`, Keyboards.mainMenu(true));
  }
}

/**
 * Скачивание официального PDF-отчета
 */
export async function handleDownloadPdf(ctx: Context) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const session = state.get(chatId);
  const metrics = session.metricsCache || await fetchRecentMetrics(chatId);

  if (!metrics) {
    await ctx.reply(`⚠️ CRM не подключена или нет данных для формирования PDF:`, Keyboards.chooseCrm);
    return;
  }

  const waitMsg = await ctx.reply(`📄 *Верстаю официальный PDF-отчет...*`, { parse_mode: 'Markdown' });

  try {
    const reportText = session.lastAuditReport?.text || '';
    const pdfBuffer = await generateAuditPdf(metrics, reportText, session.niche);

    try {
      await ctx.telegram.deleteMessage(chatId, waitMsg.message_id);
    } catch (_) {}

    await sendAuditPdfFile(
      ctx,
      pdfBuffer,
      `CRM_Business_Audit_${metrics.portalOrDomain || 'Report'}`,
      `📄 *Официальный PDF-отчет аудита CRM прикреплен выше.*\n\n_Задайте вопрос ИИ по отчету через кнопку ниже:_`,
      Keyboards.afterAuditMenu
    );
  } catch (err: any) {
    console.error('[Download PDF Error]', err);
    try {
      await ctx.telegram.deleteMessage(chatId, waitMsg.message_id);
    } catch (_) {}
    await ctx.reply(`⚠️ Ошибка при генерации PDF: ${err.message}`, Keyboards.mainMenu(true));
  }
}
