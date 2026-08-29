import { Telegraf } from 'telegraf';
import { config } from '../config';
import { handleStart, handleHelp } from './handlers/start';
import { handleConnectBitrix, handleConnectAmo, handleUseDemoData, handleSetNiche } from './handlers/connect';
import {
  handleRecentAudit,
  handleFullStreamAudit,
  handleDashboard,
  handleManagers,
  handleBenchmarks,
  handleRefreshMetrics,
} from './handlers/audit';
import { handleTextMessage } from './handlers/chat';
import { state } from '../state';
import { Keyboards } from './keyboards';

export function createBot(): Telegraf {
  if (!config.botToken) {
    throw new Error('BOT_TOKEN не задан в .env файле');
  }

  const telegrafOptions: any = {};
  if (config.proxyAgent) {
    telegrafOptions.telegram = {
      agent: config.proxyAgent,
    };
  }

  const bot = new Telegraf(config.botToken, telegrafOptions);

  // Команды
  bot.command('start', handleStart);
  bot.command('help', handleHelp);
  bot.command('reset', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId) {
      state.reset(chatId);
      await ctx.reply(`🔄 Настройки и подключение сброшены.`, Keyboards.chooseCrm);
    }
  });

  // Действия / Инлайн-кнопки
  bot.action('connect_bitrix', handleConnectBitrix);
  bot.action('connect_amocrm', handleConnectAmo);
  bot.action('use_demo_data', handleUseDemoData);
  bot.action('action_set_niche', handleSetNiche);

  bot.action('action_recent_audit', handleRecentAudit);
  bot.action('action_full_stream_audit', handleFullStreamAudit);
  bot.action('action_dashboard', handleDashboard);
  bot.action('action_managers', handleManagers);
  bot.action('action_benchmarks', handleBenchmarks);
  bot.action('action_refresh_metrics', handleRefreshMetrics);

  bot.action('action_chat_ai', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId) {
      state.setStep(chatId, 'CHAT_WITH_AI');
      await ctx.reply(
        `💬 *Режим диалога с ИИ-консультантом активен!*\n\n` +
        `Задайте любой вопрос по вашей воронке, скриптам продаж, мотивации менеджеров или работе с возражениями.\n\n` +
        `_Например:_ \`Как дожать клиентов на этапе КП?\` или \`Почему у менеджеров много просрочек?\``,
        { parse_mode: 'Markdown', ...Keyboards.backToMenu }
      );
    }
  });

  bot.action('action_change_crm', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId) {
      state.reset(chatId);
      await ctx.reply(`🔄 Выберите CRM для подключения:`, Keyboards.chooseCrm);
    }
  });

  bot.action('nav_main_menu', handleStart);

  // Обработка текстовых сообщений
  bot.on('text', handleTextMessage);

  // Глобальный перехватчик ошибок
  bot.catch((err: any, ctx) => {
    console.error(`[Telegraf Error] Для апдейта ${ctx.updateType}:`, err);
  });

  return bot;
}
