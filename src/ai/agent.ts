import { OpenAI } from 'openai';
import { config } from '../config';
import { searchWeb } from './tools/search';
import { SYSTEM_PROMPT_ANALYST, SYSTEM_PROMPT_CHAT } from './prompts';
import { BusinessMetrics, AIAgentResponse } from '../types';

const openaiOptions: any = {
  baseURL: config.openRouterBaseUrl,
  apiKey: config.openRouterApiKey,
  defaultHeaders: {
    'HTTP-Referer': 'https://crm-support.local',
    'X-Title': 'CRM Support Business Analyst Bot',
  },
  timeout: 30000,
};

if (config.proxyAgent) {
  openaiOptions.httpAgent = config.proxyAgent;
}

const openai = new OpenAI(openaiOptions);

/**
 * Очистка итогового текста от остаточных служебных тегов
 */
function sanitizeAssistantResponse(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/<toolcall>[\s\S]*?<\/toolcall>/gi, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/\[TOOL_CALLS\][\s\S]*?(?=\n\n|$)/gi, '')
    .trim();
}

/**
 * Компактизация метрик CRM в сжатый структурированный текст (~300 токенов вместо 2500+)
 */
export function formatMetricsForPrompt(metrics: BusinessMetrics): string {
  const { summary, lostReasons, managers, tasks } = metrics;

  const topLost = lostReasons.slice(0, 3).map(r => `${r.reason} (${r.count} шт.)`).join(', ') || 'Не указаны';
  const topManagers = managers.slice(0, 4).map(m =>
    `• ${m.name}: Выручка ${m.totalRevenue.toLocaleString('ru-RU')} ₽, Сделок ${m.dealsCount}, Win Rate ${m.winRatePercent}%, Просрочек: ${m.overdueTasksCount}`
  ).join('\n') || 'Данные отсутствуют';

  return `📊 ВОРОНКА СДЕЛОК:
• Всего сделок: ${summary.totalDeals}
• Успешно закрыто: ${summary.wonDeals} (Win Rate: ${summary.winRatePercent}%)
• Проиграно: ${summary.lostDeals} | В работе прямо сейчас: ${summary.inProgressDeals}
• Выручка факт: ${summary.totalRevenue.toLocaleString('ru-RU')} ₽
• Пайплайн в работе: ${summary.pipelineValue.toLocaleString('ru-RU')} ₽
• Средний чек: ${summary.averageCheck.toLocaleString('ru-RU')} ₽
• Зависшие сделки (>14 дней без движения): ${summary.stuckDealsCount} шт.
• Топ причин отказов: ${topLost}

👥 КОМАНДА И ДИСЦИПЛИНА:
${topManagers}
• Задачи: Всего ${tasks.total} шт., Просрочено ${tasks.overdue} (${tasks.overduePercent}%)`;
}

/**
 * Запуск ИИ-агента со стримингом и Fail-Fast таймаутом (12 сек на первый токен)
 */
export async function runAgent({
  messages,
  systemPrompt = SYSTEM_PROMPT_ANALYST,
  onModelSwitch,
}: {
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  systemPrompt?: string;
  onModelSwitch?: (model: string, index: number) => void;
}): Promise<AIAgentResponse> {
  const models = config.models;
  let lastError: any = null;

  const conversation: any[] = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  for (let i = 0; i < models.length; i++) {
    const currentModel = models[i];
    console.log(`[AI Agent] Запрос к модели [${i + 1}/${models.length}]: ${currentModel} (Streaming ⚡)`);

    if (onModelSwitch && i > 0) {
      onModelSwitch(currentModel, i);
    }

    try {
      const abortController = new AbortController();
      let firstTokenReceived = false;

      // Fail-Fast: таймаут 12 секунд на получение первого токена
      const timeoutId = setTimeout(() => {
        if (!firstTokenReceived) {
          console.warn(`[AI Agent] Модель ${currentModel} не ответила за 12с (Fail-Fast), переключаем...`);
          abortController.abort();
        }
      }, 12000);

      const stream = await openai.chat.completions.create(
        {
          model: currentModel,
          messages: conversation,
          temperature: 0.4,
          stream: true,
        },
        {
          signal: abortController.signal,
        }
      );

      let accumulatedText = '';

      for await (const chunk of stream) {
        if (!firstTokenReceived) {
          firstTokenReceived = true;
          clearTimeout(timeoutId);
        }
        const delta = chunk.choices[0]?.delta?.content || '';
        accumulatedText += delta;
      }

      clearTimeout(timeoutId);

      const cleanText = sanitizeAssistantResponse(accumulatedText);

      // Проверяем, что ответ не является короткой отпиской-заглушкой
      const isIntroStub = cleanText.length < 250 && (
        cleanText.toLowerCase().includes('проведу анализ') ||
        cleanText.toLowerCase().includes('найду') ||
        cleanText.toLowerCase().includes('сначала')
      );

      if (cleanText && cleanText.length >= 100 && !isIntroStub) {
        return {
          text: cleanText,
          modelUsed: currentModel,
          searches: [],
        };
      }

      throw new Error('Модель вернула вводную заглушку или слишком короткий текст');
    } catch (error: any) {
      console.error(`[AI Agent] Ошибка/таймаут с моделью ${currentModel}:`, error.message);
      lastError = error;
    }
  }

  // Если все внешние модели недоступны из-за прокси/политики OpenRouter, формируем расчетный экспертный анализ
  console.warn(`[AI Agent] Все внешние LLM недоступны. Задействуем встроенный экспертный аналитический движок...`);
  return {
    text: '',
    modelUsed: 'Expert AI Engine (Local Fallback)',
    searches: [],
    isFallbackGenerated: true,
  };
}

/**
 * Проведение полного бизнес-аудита по метрикам с Pre-Search RAG и сжатием промпта
 */
export async function performBusinessAudit(
  metrics: BusinessMetrics,
  niche = 'Не указана',
  onModelSwitch?: (model: string, index: number) => void
): Promise<AIAgentResponse> {
  const isRecent = metrics.scope === 'recent';
  const scopeTitle = isRecent
    ? 'ЭКСПРЕСС-АУДИТ ТЕКУЩЕГО ПУЛЬСА ПРОДАЖ (По выборке 50 последних измененных сделок)'
    : 'ГЛОБАЛЬНЫЙ СТРАТЕГИЧЕСКИЙ АУДИТ ВСЕЙ БАЗЫ CRM (Полный срез)';

  // 1. Pre-Search RAG: Быстрый сбор 2-3 ключевых отраслевых бенчмарков по нише
  const performedSearches: string[] = [];
  let benchmarksContext = 'Отраслевые нормы: стандартные показатели воронки B2B/B2C продаж.';

  if (niche && niche !== 'Не указана') {
    const searchQuery = `средняя конверсия воронки продаж ${niche} бенчмарки средний чек`;
    console.log(`[Pre-Search RAG] Сбор отраслевых данных из сети: "${searchQuery}"`);
    performedSearches.push(searchQuery);

    try {
      const searchResults = await searchWeb(searchQuery, 2);
      if (searchResults && searchResults.length > 0) {
        benchmarksContext = searchResults
          .slice(0, 2)
          .map((r, idx) => `• ${r.title}: ${r.snippet}`)
          .join('\n');
      }
    } catch (e: any) {
      console.warn(`[Pre-Search RAG] Поиск не удался:`, e.message);
    }
  }

  // 2. Сжатие и структурирование метрик CRM
  const formattedMetrics = formatMetricsForPrompt(metrics);

  // 3. Формирование компактного обогащенного промпта (~300 токенов)
  const userPrompt = `Проведи ${scopeTitle} на основе следующих данных:

СФЕРА БИЗНЕСА: ${niche}
ТИП ВЫБОРКИ: ${isRecent ? '50 последних активных сделок (недавние изменения)' : 'Вся база CRM'}

${formattedMetrics}

🌐 АКТУАЛЬНЫЕ РЫНОЧНЫЕ БЕНЧМАРКИ ПО НИШЕ "${niche}":
${benchmarksContext}

ИНСТРУКЦИЯ: Начни свой ответ сразу с «🩺 1. ОБЩИЙ HEALTH CHECK ОТДЕЛА ПРОДАЖ» и выдай полный детальный аудит по всем 6 разделам с конкретными расчетами и выводами. Без вводных фраз!`;

  const aiResult = await runAgent({
    messages: [{ role: 'user', content: userPrompt }],
    systemPrompt: SYSTEM_PROMPT_ANALYST,
    onModelSwitch,
  });

  aiResult.searches = performedSearches;

  // Если сработал локальный аналитический движок (при сбое прокси/OpenRouter)
  if (aiResult.isFallbackGenerated || !aiResult.text) {
    aiResult.text = generateAnalyticalReport(metrics, niche);
  }

  return aiResult;
}

/**
 * Консультация / чат с ИИ
 */
export async function askAIQuestion(
  question: string,
  metrics: BusinessMetrics | null,
  chatHistory: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [],
  niche = 'Не указана'
): Promise<AIAgentResponse> {
  let benchmarksContext = '';
  const performedSearches: string[] = [];

  // Если в вопросе запрашиваются нормы рынка/конкуренты, делаем быстрый пре-поиск
  const lowerQ = question.toLowerCase();
  if (lowerQ.includes('рынок') || lowerQ.includes('конверси') || lowerQ.includes('бенчмарк') || lowerQ.includes('норма')) {
    const query = `${niche} ${question}`.slice(0, 100);
    performedSearches.push(query);
    try {
      const results = await searchWeb(query, 2);
      if (results && results.length > 0) {
        benchmarksContext = `\n\nДанные из поисковой выдачи:\n` + results.map(r => `• ${r.title}: ${r.snippet}`).join('\n');
      }
    } catch (_) {}
  }

  const contextMessage = metrics
    ? `Контекст метрик CRM пользователя (ниша: ${niche}, режим: ${metrics.scope || 'recent'}):\n${JSON.stringify(metrics, null, 2)}${benchmarksContext}`
    : `Контекст: CRM еще не подключена или метрики отсутствуют.${benchmarksContext}`;

  const messages: any[] = [
    { role: 'system', content: `${SYSTEM_PROMPT_CHAT}\n\n${contextMessage}` },
    ...chatHistory.slice(-6),
    { role: 'user', content: question },
  ];

  const aiResult = await runAgent({
    messages,
    systemPrompt: SYSTEM_PROMPT_CHAT,
  });

  aiResult.searches = performedSearches;

  if (aiResult.isFallbackGenerated || !aiResult.text) {
    aiResult.text = generateConsultantResponse(question, metrics, niche);
  }

  return aiResult;
}

/**
 * Встроенный экспертный генератор отчета на случай недоступности OpenRouter
 */
function generateAnalyticalReport(metrics: BusinessMetrics, niche: string): string {
  const { summary, lostReasons, managers, tasks } = metrics;
  const isRecent = metrics.scope === 'recent';
  const winRate = summary.winRatePercent;
  const healthScore = winRate > 30 ? 8 : winRate > 15 ? 6 : 4;

  const topLost = lostReasons.length > 0
    ? lostReasons.slice(0, 3).map(r => `• *${r.reason}*: ${r.count} сделок`).join('\n')
    : '• Причины отказов не заполняются менеджерами (слепая зона воронки)';

  const topManagers = [...managers].sort((a, b) => b.totalRevenue - a.totalRevenue);
  const managerList = topManagers.slice(0, 3).map(m =>
    `• *${m.name}*: Выручка ${m.totalRevenue.toLocaleString('ru-RU')} ₽ (Сделок: ${m.dealsCount}, Win Rate: ${m.winRatePercent}%, Просрочек: ${m.overdueTasksCount})`
  ).join('\n') || '• Данные по сотрудникам отсутствуют';

  const headerTitle = isRecent
    ? `⚡ *1. HEALTH CHECK: ТЕКУЩИЙ ПУЛЬС ПРОДАЖ (ПОСЛЕДНИЕ 50 СДЕЛОК)*`
    : `🩺 *1. СТРАТЕГИЧЕСКИЙ HEALTH CHECK ВСЕЙ БАЗЫ CRM*`;

  return `${headerTitle}
Оценка эффективности: *${healthScore} из 10*
Ниша: *${niche}*
CRM: *${metrics.crmType === 'bitrix24' ? 'Битрикс24' : 'amoCRM'}* (${isRecent ? 'Выборка последних изменений' : 'Полная база'})

📊 *2. РАЗБОР ВОРОНКИ И КОНВЕРСИЙ*
• Сделок в анализе: *${summary.totalDeals}*
• Успешно закрыто: *${summary.wonDeals}* (${summary.winRatePercent}%)
• Проиграно: *${summary.lostDeals}* (${(100 - summary.winRatePercent).toFixed(1)}%)
• В работе прямо сейчас: *${summary.inProgressDeals}*

💰 *3. ФИНАНСОВЫЙ ДАШБОРД*
• Выручка: *${summary.totalRevenue.toLocaleString('ru-RU')} ₽*
• Объем в воронке (пайплайн): *${summary.pipelineValue.toLocaleString('ru-RU')} ₽*
• Средний чек: *${summary.averageCheck.toLocaleString('ru-RU')} ₽*

⚠️ *4. УЗКИЕ МЕСТА И КРИТИЧЕСКИЕ ПОТЕРИ*
• ⏳ *Зависшие сделки (>14 дней без движения)*: *${summary.stuckDealsCount} сделок* (риск потери выручки!).
• ❌ *Топ причин отказов*:
${topLost}

👥 *5. АУДИТ КОМАНДЫ И ДИСЦИПЛИНЫ*
• Всего задач: *${tasks.total}* | Просрочено: *${tasks.overdue}* (*${tasks.overduePercent}%* от общего числа).
${tasks.overduePercent > 20 ? '⚠️ *Критический уровень просрочек!* Менеджеры забывают о клиентах.' : '✅ Контроль задач в норме.'}
*Лидеры по результатам:*
${managerList}

🚀 *6. ТОП-3 БЫСТРЫХ ДЕЙСТВИЯ (QUICK WINS НА 7 ДНЕЙ)*
1. **Ревизия зависших сделок**: Выгрузить ${summary.stuckDealsCount} зависших сделок и запустить по ним спецпредложение / дожимной звонок РОПа.
2. **Ликвидация ${tasks.overdue} просроченных задач**: Ввести правило «0 просрочек к концу рабочего дня».
3. **Обязательное заполнение причин отказа**: Ликвидировать слив лидов за счет скрипта обработки возражения «Дорого / Думаю».`;
}

/**
 * Встроенный генератор ответа на вопросы
 */
function generateConsultantResponse(question: string, metrics: BusinessMetrics | null, niche: string): string {
  if (!metrics) {
    return `По вопросу: "${question}"\n\nДля точного анализа рекомендую подключить вашу CRM через кнопку «Подключить CRM», чтобы я видел конверсии вашей воронки и средний чек.`;
  }

  const q = question.toLowerCase();

  if (q.includes('чек') || q.includes('средний чек') || q.includes('выручк')) {
    return `💰 *Анализ среднего чека (${metrics.summary.averageCheck.toLocaleString('ru-RU')} ₽):*\n\n1. **Cross-sell / Up-sell**: Добавьте в регламент менеджеров обязательное предложение сопутствующих услуг/товаров на этапе согласования счета.\n2. **Пакетные предложения**: Сформируйте 3 тарифа (Базовый / Оптимум / Премиум) — это автоматически поднимает чек на 15–25%.\n3. **Минимальный порог отгрузки**: Ограничьте работу с мелкими нерентабельными заказами.`;
  }

  if (q.includes('конверси') || q.includes('воронка') || q.includes('кп') || q.includes('дожим')) {
    return `📊 *Рекомендации по росту конверсии (текущая: ${metrics.summary.winRatePercent}%):*\n\n1. **Регламент скорости первого контакта**: Звонок лиду в течение первых 15 минут поднимает конверсию в 2.5 раза.\n2. **Квалификация на входе**: Не отправляйте КП без выявления бюджета и лица, принимающего решения (ЛПР).\n3. **Встреча / Презентация**: Защищайте КП лично или через Zoom, а не просто отправкой PDF на почту.`;
  }

  if (q.includes('менеджер') || q.includes('сотрудник') || q.includes('задач') || q.includes('просроч')) {
    return `👥 *Анализ работы команды:*\n\nВ вашей CRM сейчас *${metrics.tasks.overdue} просроченных задач* (${metrics.tasks.overduePercent}%).\n\nРекомендации:\n1. Внедрить ежедневные 15-минутные утренние планерки РОПа с разбором просрочек.\n2. Перераспределить зависшие сделы (${metrics.summary.stuckDealsCount} шт.) между менее загруженными сотрудниками.\n3. Привязать KPI менеджера к отсутствию просроченных задач.`;
  }

  return `💡 *Экспертный анализ по вашему запросу:*\n\nС учетом вашей ниши (*${niche}*) и текущей воронки (*${metrics.summary.winRatePercent}% конверсия*, *${metrics.summary.averageCheck.toLocaleString('ru-RU')} ₽ средний чек*):\n\n• Сосредоточьтесь на конверсии этапа «В работе ➔ Оплата».\n• Устраните ${metrics.summary.stuckDealsCount} зависших сделок — там заморожена ваша потенциальная выручка (*${metrics.summary.pipelineValue.toLocaleString('ru-RU')} ₽*).\n• Задайте любой уточняющий вопрос: про скрипты, KPI менеджеров, воронку или работу с возражениями!`;
}
