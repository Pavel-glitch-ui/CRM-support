import { Context } from 'telegraf';
import { state } from '../../state';
import { Keyboards } from '../keyboards';

export async function handleStart(ctx: Context) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const session = state.get(chatId);

  if (session.crmType && session.credentials) {
    const crmName = session.crmType === 'bitrix24' ? 'Битрикс24' : 'amoCRM';
    const nicheText = session.niche ? `\n🏢 Сфера бизнеса: *${session.niche}*` : '\n🏢 Сфера бизнеса: _не указана_';

    await ctx.reply(
      `👋 *С возвращением в ИИ-Бизнес Аналитик!*\n\n` +
      `🔗 Подключено: *${crmName}*${nicheText}\n\n` +
      `Выберите действие из меню ниже для анализа воронки, поиска рыночных бенчмарков или аудита команды:`,
      {
        parse_mode: 'Markdown',
        ...Keyboards.mainMenu(Boolean(session.metricsCache)),
      }
    );
    return;
  }

  await ctx.reply(
    `👋 *Привет! Я — ИИ-Бизнес Аналитик и CRM-аудитор.*\n\n` +
    `Я провожу глубокую диагностику вашего отдела продаж на основе реальных данных из CRM:\n` +
    `• 📊 *Анализ воронки*: выявление «дыр», где теряются лиды и выручка.\n` +
    `• 💰 *Финансы*: расчет среднего чека, Win Rate и зависших сделок.\n` +
    `• 👥 *Аудит менеджеров*: контроль нагрузки и просроченных задач.\n` +
    `• 🌐 *Web Search*: поиск рыночных бенчмарков и конкурентных норм конверсий через интернет.\n` +
    `• 🚀 *План Quick Wins*: конкретные шаги на 7 дней для собственника.\n\n` +
    `*Выберите способ подключения вашей CRM для старта:*`,
    {
      parse_mode: 'Markdown',
      ...Keyboards.chooseCrm,
    }
  );
}

export async function handleHelp(ctx: Context) {
  await ctx.reply(
    `ℹ️ *Как работает ИИ-Бизнес Аналитик:*\n\n` +
    `1. *Безопасность*: Мы не храним ваши данные в базах данных (работаем в In-Memory демо-режиме).\n` +
    `2. *Сбор данных*: Бот выгружает агрегированные цифры по сделкам и задачам из Битрикс24 или amoCRM.\n` +
    `3. *ИИ-Анализ*: OpenRouter AI с каскадом бесплатных моделей проводит аудит показателей.\n` +
    `4. *Интернет-поиск*: При аудите бот находит средние конверсии по вашей нише для сравнения с рынком.\n\n` +
    `Команды:\n` +
    `• /start — Главное меню\n` +
    `• /reset — Сбросить подключение и начать заново`,
    {
      parse_mode: 'Markdown',
      ...Keyboards.backToMenu,
    }
  );
}
