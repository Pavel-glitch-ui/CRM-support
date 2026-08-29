import { OpenAI } from 'openai';
import { config } from '../config';
import { searchWeb, searchToolDefinition } from './tools/search';
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
 * Запуск ИИ-агента с каскадным перебором моделей
 */
export async function runAgent({
  messages,
  systemPrompt = SYSTEM_PROMPT_ANALYST,
  enableSearch = true,
  onModelSwitch,
}: {
  messages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string; name?: string; tool_call_id?: string }>;
  systemPrompt?: string;
  enableSearch?: boolean;
  onModelSwitch?: (model: string, index: number) => void;
}): Promise<AIAgentResponse> {
  const models = config.models;
  let lastError: any = null;
  const performedSearches: string[] = [];

  const conversation: any[] = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  for (let i = 0; i < models.length; i++) {
    const currentModel = models[i];
    console.log(`[AI Agent] Пробуем модель [${i + 1}/${models.length}]: ${currentModel}`);

    if (onModelSwitch && i > 0) {
      onModelSwitch(currentModel, i);
    }

    try {
      const callParams: any = {
        model: currentModel,
        messages: conversation,
        temperature: 0.6,
      };

      if (enableSearch) {
        callParams.tools = [searchToolDefinition];
        callParams.tool_choice = 'auto';
      }

      let response: any;
      try {
        response = await openai.chat.completions.create(callParams);
      } catch (toolError: any) {
        if (
          toolError.message &&
          (toolError.message.includes('tool') || toolError.message.includes('function') || toolError.status === 400)
        ) {
          console.warn(`[AI Agent] Модель ${currentModel} не поддерживает Tools API, переключаемся на стандартный запрос...`);
          const { tools, tool_choice, ...newParams } = callParams;
          response = await openai.chat.completions.create(newParams);
        } else {
          throw toolError;
        }
      }

      const choice = response.choices && response.choices[0];
      if (!choice || !choice.message) {
        throw new Error('Пустой ответ от модели');
      }

      const responseMessage = choice.message;

      // Обработка вызова инструментов
      if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        console.log(`[AI Agent] Модель запросила вызов инструментов (${responseMessage.tool_calls.length})`);
        conversation.push(responseMessage);

        for (const toolCall of responseMessage.tool_calls) {
          if (toolCall.function && toolCall.function.name === 'search_web') {
            let query = '';
            try {
              const args = JSON.parse(toolCall.function.arguments || '{}');
              query = args.query;
            } catch (e) {
              query = toolCall.function.arguments;
            }

            if (query) {
              console.log(`[AI Agent] Выполняем веб-поиск: "${query}"`);
              performedSearches.push(query);
              const searchResults = await searchWeb(query, config.search.maxResults);

              conversation.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                name: 'search_web',
                content: JSON.stringify(searchResults, null, 2),
              });
            }
          }
        }

        const finalResponse = await openai.chat.completions.create({
          model: currentModel,
          messages: conversation,
          temperature: 0.4,
        });

        const finalChoice = finalResponse.choices && finalResponse.choices[0];
        const finalText = finalChoice && finalChoice.message ? finalChoice.message.content : '';

        return {
          text: finalText || 'Анализ завершен.',
          modelUsed: currentModel,
          searches: performedSearches,
        };
      }

      return {
        text: responseMessage.content || '',
        modelUsed: currentModel,
        searches: performedSearches,
      };
    } catch (error: any) {
      console.error(`[AI Agent] Ошибка с моделью ${currentModel}:`, error.message);
      lastError = error;
    }
  }

  // Если все внешние модели недоступны из-за прокси/политики OpenRouter, формируем расчетный экспертный анализ
  console.warn(`[AI Agent] Все внешние LLM недоступны. Задействуем встроенный экспертный аналитический движок...`);
  return {
    text: '',
    modelUsed: 'Expert AI Engine (Local Fallback)',
    searches: performedSearches,
    isFallbackGenerated: true,
  };
}

/**
 * Проведение полного бизнес-аудита по метрикам
 */
export async function performBusinessAudit(
  metrics: BusinessMetrics,
  niche = 'Не указана',
  onModelSwitch?: (model: string, index: number) => void
): Promise<AIAgentResponse> {
  const userPrompt = `Проведи детальный бизнес-аудит отдела продаж на основе следующих метрик из CRM:

СФЕРА БИЗНЕСА: ${niche}

ДАННЫЕ ИЗ CRM:
${JSON.stringify(metrics, null, 2)}

Пожалуйста, используй инструмент search_web для поиска бенчмарков в нише "${niche}" (если ниша указана), и выдай полный структурированный отчет для собственника бизнеса с конкретным планом действий на 7 дней.`;

  const aiResult = await runAgent({
    messages: [{ role: 'user', content: userPrompt }],
    systemPrompt: SYSTEM_PROMPT_ANALYST,
    enableSearch: true,
    onModelSwitch,
  });

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
  const contextMessage = metrics
    ? `Контекст метрик CRM пользователя (ниша: ${niche}):\n${JSON.stringify(metrics, null, 2)}`
    : `Контекст: CRM еще не подключена или метрики отсутствуют.`;

  const messages: any[] = [
    { role: 'system', content: `${SYSTEM_PROMPT_CHAT}\n\n${contextMessage}` },
    ...chatHistory.slice(-6),
    { role: 'user', content: question },
  ];

  const aiResult = await runAgent({
    messages,
    systemPrompt: SYSTEM_PROMPT_CHAT,
    enableSearch: true,
  });

  if (aiResult.isFallbackGenerated || !aiResult.text) {
    aiResult.text = generateConsultantResponse(question, metrics, niche);
  }

  return aiResult;
}

/**
 * Встроенный экспертный генератор отчета на случай недоступности OpenRouter
 */
function generateAnalyticalReport(metrics: BusinessMetrics, niche: string): string {
  const { summary, lostReasons, managers, tasks, pipelines } = metrics;
  const winRate = summary.winRatePercent;
  const healthScore = winRate > 30 ? 8 : winRate > 15 ? 6 : 4;

  const topLost = lostReasons.length > 0
    ? lostReasons.slice(0, 3).map(r => `• *${r.reason}*: ${r.count} сделок`).join('\n')
    : '• Причины отказов не заполняются менеджерами (слепая зона воронки)';

  const topManagers = [...managers].sort((a, b) => b.totalRevenue - a.totalRevenue);
  const managerList = topManagers.slice(0, 3).map(m =>
    `• *${m.name}*: Выручка ${m.totalRevenue.toLocaleString('ru-RU')} ₽ (Сделок: ${m.dealsCount}, Win Rate: ${m.winRatePercent}%, Просрочек: ${m.overdueTasksCount})`
  ).join('\n') || '• Данные по сотрудникам отсутствуют';

  return `🩺 *1. HEALTH CHECK ОТДЕЛА ПРОДАЖ*
Оценка эффективности: *${healthScore} из 10*
Ниша: *${niche}*
CRM: *${metrics.crmType === 'bitrix24' ? 'Битрикс24' : 'amoCRM'}*

📊 *2. РАЗБОР ВОРОНКИ И КОНВЕРСИЙ*
• Всего сделок в базе: *${summary.totalDeals}*
• Успешно закрыто: *${summary.wonDeals}* (${summary.winRatePercent}%)
• Проиграно: *${summary.lostDeals}* (${(100 - summary.winRatePercent).toFixed(1)}%)
• В работе прямо сейчас: *${summary.inProgressDeals}*

💰 *3. ФИНАНСОВЫЙ ДАШБОРД*
• Фактическая выручка: *${summary.totalRevenue.toLocaleString('ru-RU')} ₽*
• Объем денег в воронке (пайплайн): *${summary.pipelineValue.toLocaleString('ru-RU')} ₽*
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
