import { Context } from 'telegraf';
import { state } from '../../state';
import { Keyboards } from '../keyboards';
import { Bitrix24Client } from '../../crm/bitrix24';
import { AmoCrmClient } from '../../crm/amocrm';
import { askAIQuestion } from '../../ai/agent';

export async function handleTextMessage(ctx: Context) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const text = (ctx.message as any)?.text?.trim();
  if (!text) return;

  const session = state.get(chatId);

  // 1. Ожидание вебхука Битрикс24
  if (session.step === 'AWAITING_B24_WEBHOOK') {
    if (!text.startsWith('http') || !text.includes('bitrix')) {
      await ctx.reply(
        `⚠️ Ссылка должна начинаться с \`https://\` и вести на ваш портал Битрикс24.\n\n` +
        `_Пример:_ \`https://company.bitrix24.ru/rest/1/abcdef123456/\`\n\nПопробуйте еще раз:`,
        { parse_mode: 'Markdown', ...Keyboards.backToMenu }
      );
      return;
    }

    const checkingMsg = await ctx.reply(`⏳ Проверяю подключение к Битрикс24...`);
    const client = new Bitrix24Client(text);
    const isValid = await client.testConnection();

    try {
      await ctx.telegram.deleteMessage(chatId, checkingMsg.message_id);
    } catch (_) {}

    if (isValid) {
      state.setCrm(chatId, 'bitrix24', { webhookUrl: text });
      state.setStep(chatId, 'AWAITING_NICHE');

      await ctx.reply(
        `✅ *Битрикс24 успешно подключен!*\n\n` +
        `Теперь укажите вашу сферу бизнеса / нишу (например: \`B2B опт стройматериалов\` или \`IT агентство\`):\n\n` +
        `_Это позволит ИИ находить точные бенчмарки в интернете._`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.reply(
        `❌ Не удалось подключиться к Битрикс24. Проверьте правильность URL вебхука и выданные права (CRM, Задачи).`,
        Keyboards.chooseCrm
      );
    }
    return;
  }

  // 2. Ожидание данных amoCRM
  if (session.step === 'AWAITING_AMO_CREDENTIALS') {
    const parts = text.split(':');
    if (parts.length < 2) {
      await ctx.reply(
        `⚠️ Отправьте данные в формате: \`домен:токен\`\n_Пример:_ \`company.amocrm.ru:eyJ0eXAi...\``,
        { parse_mode: 'Markdown', ...Keyboards.backToMenu }
      );
      return;
    }

    const domain = parts[0].trim();
    const token = parts.slice(1).join(':').trim();

    const checkingMsg = await ctx.reply(`⏳ Проверяю токен amoCRM...`);
    const client = new AmoCrmClient(domain, token);
    const isValid = await client.testConnection();

    try {
      await ctx.telegram.deleteMessage(chatId, checkingMsg.message_id);
    } catch (_) {}

    if (isValid) {
      state.setCrm(chatId, 'amocrm', { domain, token });
      state.setStep(chatId, 'AWAITING_NICHE');

      await ctx.reply(
        `✅ *amoCRM успешно подключена!*\n\n` +
        `Теперь укажите вашу сферу бизнеса / нишу (например: \`Онлайн-школа\` или \`Продажа недвижимости\`):`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.reply(
        `❌ Не удалось авторизоваться в amoCRM. Проверьте правильность домена и долгосрочного токена.`,
        Keyboards.chooseCrm
      );
    }
    return;
  }

  // 3. Ожидание указания ниши
  if (session.step === 'AWAITING_NICHE') {
    state.setNiche(chatId, text);
    state.setStep(chatId, 'IDLE');

    await ctx.reply(
      `🎯 *Сфера бизнеса сохранена:* "${text}"\n\n` +
      `Теперь всё готово к анализу! Нажмите кнопку ниже:`,
      {
        parse_mode: 'Markdown',
        ...Keyboards.mainMenu(Boolean(session.metricsCache)),
      }
    );
    return;
  }

  // 4. Вопрос к ИИ-консультанту
  const typingMsg = await ctx.reply(`🤔 *ИИ-Консультант формулирует ответ...*`, { parse_mode: 'Markdown' });

  try {
    const response = await askAIQuestion(
      text,
      session.metricsCache,
      session.chatHistory,
      session.niche || 'B2B/B2C'
    );

    state.appendChat(chatId, 'user', text);
    state.appendChat(chatId, 'assistant', response.text);

    const fullAnswerText = response.text;

    try {
      await ctx.telegram.editMessageText(
        chatId,
        typingMsg.message_id,
        undefined,
        fullAnswerText,
        {
          parse_mode: 'Markdown',
          ...Keyboards.mainMenu(Boolean(session.metricsCache)),
        }
      );
    } catch (_) {
      try {
        await ctx.telegram.deleteMessage(chatId, typingMsg.message_id);
      } catch (_) {}
      await ctx.reply(
        fullAnswerText,
        {
          parse_mode: 'Markdown',
          ...Keyboards.mainMenu(Boolean(session.metricsCache)),
        }
      );
    }
  } catch (error: any) {
    console.error('[Chat AI Error]', error);
    try {
      await ctx.telegram.deleteMessage(chatId, typingMsg.message_id);
    } catch (_) {}
    await ctx.reply(`⚠️ Ошибка обработки вопроса: ${error.message}`, Keyboards.mainMenu(true));
  }
}
