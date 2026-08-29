import { Context } from 'telegraf';
import { state } from '../../state';
import { Keyboards } from '../keyboards';
import { Bitrix24Client } from '../../crm/bitrix24';
import { AmoCrmClient } from '../../crm/amocrm';
import { aggregateBitrixMetrics, aggregateAmoMetrics } from '../../crm/aggregator';
import { performBusinessAudit } from '../../ai/agent';
import { searchWeb } from '../../ai/tools/search';
import { BusinessMetrics } from '../../types';

/**
 * Получение свежих или кэшированных метрик из CRM
 */
async function getOrFetchMetrics(chatId: string | number): Promise<BusinessMetrics | null> {
  const session = state.get(chatId);
  if (session.metricsCache) {
    return session.metricsCache;
  }

  if (!session.crmType || !session.credentials) {
    return null;
  }

  try {
    if (session.crmType === 'bitrix24') {
      const creds = session.credentials as { webhookUrl: string };
      const client = new Bitrix24Client(creds.webhookUrl);
      const rawData = await client.fetchAllData();
      const metrics = aggregateBitrixMetrics(rawData, creds.webhookUrl);
      state.setMetrics(chatId, metrics);
      return metrics;
    } else if (session.crmType === 'amocrm') {
      const creds = session.credentials as { domain: string; token: string };
      const client = new AmoCrmClient(creds.domain, creds.token);
      const rawData = await client.fetchAllData();
      const metrics = aggregateAmoMetrics(rawData, creds.domain);
      state.setMetrics(chatId, metrics);
      return metrics;
    }
  } catch (error: any) {
    console.error(`[Metrics Fetch] Ошибка сбора данных из CRM:`, error.message);
  }

  return null;
}

/**
 * Полный ИИ-аудит бизнеса
 */
export async function handleFullAudit(ctx: Context) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const session = state.get(chatId);
  if (!state.isConnected(chatId) && !session.metricsCache) {
    await ctx.reply(`⚠️ Сначала подключите вашу CRM или запустите демо-режим:`, Keyboards.chooseCrm);
    return;
  }

  const statusMsg = await ctx.reply(
    `⏳ *ИИ-Агент начинает аудит бизнеса...*\n\n` +
    `1. 📊 Сбор и расчет метрик воронки\n` +
    `2. 🔍 Поиск отраслевых бенчмарков в интернете (DuckDuckGo)\n` +
    `3. 🧠 Формирование отчета и плана Quick Wins\n\n` +
    `_Пожалуйста, подождите 5–15 секунд..._`,
    { parse_mode: 'Markdown' }
  );

  try {
    const metrics = await getOrFetchMetrics(chatId);
    if (!metrics) {
      try {
        await ctx.telegram.deleteMessage(chatId, statusMsg.message_id);
      } catch (_) {}
      await ctx.reply(`❌ Не удалось выгрузить данные из CRM. Проверьте права вебхука или токена.`, Keyboards.backToMenu);
      return;
    }

    const auditResult = await performBusinessAudit(
      metrics,
      session.niche || 'B2B/B2C продажи и услуги',
      async () => {
        try {
          await ctx.telegram.editMessageText(
            chatId,
            statusMsg.message_id,
            undefined,
            `⏳ *ИИ-Агент проводит глубокий анализ воронки...*\n\n` +
            `_Пожалуйста, подождите..._`,
            { parse_mode: 'Markdown' }
          );
        } catch (_) {}
      }
    );

    let searchesNote = '';
    if (auditResult.searches && auditResult.searches.length > 0) {
      searchesNote = `\n\n🌐 *Использованные поисковые запросы по рынку:*\n` +
        auditResult.searches.map(s => `• _${s}_`).join('\n');
    }

    const fullReportText = auditResult.text + searchesNote;

    // Пытаемся отредактировать статусное сообщение или отправляем новый отчет
    try {
      await ctx.telegram.editMessageText(
        chatId,
        statusMsg.message_id,
        undefined,
        fullReportText,
        {
          parse_mode: 'Markdown',
          ...Keyboards.afterAuditMenu,
        }
      );
    } catch (editError) {
      // Если редактирование не прошло (например, из-за специфических символов markdown), удаляем статус и отправляем чистым reply
      try {
        await ctx.telegram.deleteMessage(chatId, statusMsg.message_id);
      } catch (_) {}
      await ctx.reply(fullReportText, {
        parse_mode: 'Markdown',
        ...Keyboards.afterAuditMenu,
      });
    }
  } catch (error: any) {
    console.error('[Audit Handler Error]', error);
    try {
      await ctx.telegram.deleteMessage(chatId, statusMsg.message_id);
    } catch (_) {}
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
  const metrics = await getOrFetchMetrics(chatId);

  if (!metrics) {
    await ctx.reply(`⚠️ CRM не подключена:`, Keyboards.chooseCrm);
    return;
  }

  const { summary } = metrics;

  await ctx.reply(
    `📊 *ЭКСПРЕСС-ДАШБОРД ВОРОНКИ ПРОДАЖ*\n\n` +
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

  const metrics = await getOrFetchMetrics(chatId);
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
      `💡 *Чтобы сравнить эти показатели с вашими цифрами, запустите «Полный ИИ-аудит бизнеса».*`;

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
    } catch (_) {}
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
