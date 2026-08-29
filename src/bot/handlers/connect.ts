import { Context } from 'telegraf';
import { state } from '../../state';
import { Keyboards } from '../keyboards';
import { Bitrix24Client } from '../../crm/bitrix24';
import { AmoCrmClient } from '../../crm/amocrm';

export async function handleConnectBitrix(ctx: Context) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  state.setStep(chatId, 'AWAITING_B24_WEBHOOK');

  await ctx.reply(
    `🟦 *Подключение Битрикс24 (занимает 30 секунд)*\n\n` +
    `1. Откройте страницу создания вебхука в вашем портале:\n` +
    `   👉 *Меню слева ➔ Разработчикам ➔ Другое ➔ Входящий вебхук*\n` +
    `   _(или перейдите по ссылке: \`https://ВАШ_ДОМЕН.bitrix24.ru/devops/edit/webhook/0/\`)_\n\n` +
    `2. В блоке *«Настройка прав»* отметьте галочками:\n` +
    `   ✅ **CRM**\n` +
    `   ✅ **Задачи**\n` +
    `   ✅ **Пользователи (структура компании)**\n\n` +
    `3. Нажмите кнопку *«Сохранить»* внизу страницы и скопируйте полученный **URL вебхука**.\n\n` +
    `📝 *Отправьте скопированный URL сюда в ответном сообщении:*`,
    {
      parse_mode: 'Markdown',
      ...Keyboards.backToMenu,
    }
  );
}

export async function handleConnectAmo(ctx: Context) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  state.setStep(chatId, 'AWAITING_AMO_CREDENTIALS');

  await ctx.reply(
    `🟧 *Подключение amoCRM (занимает 1 минуту)*\n\n` +
    `1. В вашем аккаунте amoCRM перейдите в:\n` +
    `   👉 *amoМаркет ➔ Создать интеграцию (для себя)*\n\n` +
    `2. Во вкладке *«Ключи и доступы»* скопируйте **Долгосрочный токен**.\n\n` +
    `3. Скопируйте ваш субдомен (например, \`company.amocrm.ru\` или просто \`company\`).\n\n` +
    `📝 *Отправьте данные в чат в формате:*\n` +
    `\`домен:токен\`\n\n` +
    `_Пример:_ \`mycompany.amocrm.ru:eyJ0eXAiOiJKV1QiLC...\``,
    {
      parse_mode: 'Markdown',
      ...Keyboards.backToMenu,
    }
  );
}

export async function handleUseDemoData(ctx: Context) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  // Создаем готовый демо-профиль компании (b2b оптовая торговля / услуги)
  state.setCrm(chatId, 'bitrix24', { webhookUrl: 'https://demo-portal.bitrix24.ru/rest/1/demo_token/' });
  state.setNiche(chatId, 'B2B Оптовые поставки и дистрибуция');

  // Генерируем реалистичный датасет
  state.setMetrics(chatId, {
    crmType: 'bitrix24',
    portalOrDomain: 'demo-b2b-company.bitrix24.ru',
    collectedAt: new Date().toISOString(),
    summary: {
      totalDeals: 142,
      wonDeals: 38,
      lostDeals: 52,
      inProgressDeals: 52,
      totalRevenue: 14650000,
      pipelineValue: 28400000,
      averageCheck: 385526,
      winRatePercent: 27,
      stuckDealsCount: 19,
    },
    lostReasons: [
      { reason: 'Дорого / Слишком высокая цена', count: 23 },
      { reason: 'Купили у конкурента с отсрочкой платежа', count: 16 },
      { reason: 'Не смогли дозвониться после отправки КП', count: 13 },
    ],
    pipelines: [
      {
        id: '0',
        name: 'Оптовые продажи РФ',
        totalDeals: 142,
        wonDeals: 38,
        lostDeals: 52,
        inProgressDeals: 52,
        totalRevenue: 14650000,
        pipelineValue: 28400000,
        averageCheck: 385526,
        winRatePercent: 27,
        stages: [],
      },
    ],
    managers: [
      {
        id: '1',
        name: 'Алексей Смирнов (Senior)',
        dealsCount: 48,
        wonDealsCount: 19,
        lostDealsCount: 14,
        totalRevenue: 8900000,
        openTasksCount: 12,
        overdueTasksCount: 1,
        winRatePercent: 40,
      },
      {
        id: '2',
        name: 'Елена Кузнецова (Middle)',
        dealsCount: 54,
        wonDealsCount: 14,
        lostDealsCount: 22,
        totalRevenue: 4450000,
        openTasksCount: 28,
        overdueTasksCount: 9,
        winRatePercent: 26,
      },
      {
        id: '3',
        name: 'Дмитрий Попов (Junior)',
        dealsCount: 40,
        wonDealsCount: 5,
        lostDealsCount: 16,
        totalRevenue: 1300000,
        openTasksCount: 34,
        overdueTasksCount: 18,
        winRatePercent: 13,
      },
    ],
    tasks: {
      total: 74,
      overdue: 28,
      overduePercent: 38,
    },
  });

  await ctx.reply(
    `✨ *Демо-CRM успешно загружена!*\n\n` +
    `🏢 Сфера: *B2B Оптовые поставки и дистрибуция*\n` +
    `📊 Загружено: *142 сделки, 3 менеджера, 74 задачи*\n\n` +
    `Теперь вы можете запустить полный ИИ-аудит, протестировать интернет-поиск бенчмарков или задать вопрос консультанту:`,
    {
      parse_mode: 'Markdown',
      ...Keyboards.mainMenu(true),
    }
  );
}

export async function handleSetNiche(ctx: Context) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  state.setStep(chatId, 'AWAITING_NICHE');

  await ctx.reply(
    `🏢 *Укажите вашу сферу бизнеса / нишу:*\n\n` +
    `Это позволит ИИ-агенту через интернет найти точные отраслевые бенчмарки конверсий и среднего чека.\n\n` +
    `_Примеры:_ \`Онлайн-школа программирования\`, \`Продажа стройматериалов оптом\`, \`Агентство недвижимости\`\n\n` +
    `📝 *Напишите вашу нишу в чат:*`,
    {
      parse_mode: 'Markdown',
      ...Keyboards.backToMenu,
    }
  );
}
