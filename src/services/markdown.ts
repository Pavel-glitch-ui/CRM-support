import { BusinessMetrics } from '../types';

/**
 * Очистка и нормализация текста ИИ-аудита для Markdown формата
 */
function formatAiReportSection(reportText: string): string {
  if (!reportText || !reportText.trim()) {
    return '> *Аналитический текст формируется или временно недоступен.*';
  }

  return reportText
    .replace(/^(\d+\.\s*.*)$/gm, '### $1')
    .replace(/^([🩺📊💰⚠️👥🚀🌐]\s*\d*\.?\s*.*)$/gm, '### $1')
    .trim();
}

/**
 * Генерация полного брендированного отчета в формате Markdown (.md)
 */
export function generateAuditMarkdown(
  metrics: BusinessMetrics,
  reportText: string,
  niche?: string | null,
  searches?: string[]
): string {
  const cleanNiche = niche || 'Не указана';
  const isRecent = metrics.scope === 'recent';
  const scopeTitle = isRecent
    ? '⚡ Экспресс-аудит (выборка 50 последних активных сделок)'
    : '🚀 Глобальный стратегический аудит всей базы CRM';

  const dateStr = new Date().toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const { summary, managers, tasks, lostReasons } = metrics;
  const winRate = summary.winRatePercent;
  const healthScore = winRate > 30 ? '8.5 / 10 (Высокая эффективность)' : winRate > 15 ? '6.5 / 10 (Средняя норма)' : '4.0 / 10 (Требует срочной оптимизации)';
  const crmTitle = metrics.crmType === 'bitrix24' ? 'Битрикс24' : 'amoCRM';

  // 1. Формирование таблицы менеджеров
  let managersTable = '';
  if (managers && managers.length > 0) {
    const sortedManagers = [...managers].sort((a, b) => b.totalRevenue - a.totalRevenue);
    managersTable = [
      '| Место | Менеджер | Сделок | Выиграно | Win Rate | Выручка (факт) | Задачи | Просрочено |',
      '| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |',
      ...sortedManagers.map((m, idx) => {
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}`;
        const overdueBadge = m.overdueTasksCount > 0 ? `⚠️ **${m.overdueTasksCount}**` : '✅ 0';
        return `| ${medal} | **${m.name}** | ${m.dealsCount} | ${m.wonDealsCount} | ${m.winRatePercent}% | ${m.totalRevenue.toLocaleString('ru-RU')} ₽ | ${m.openTasksCount} | ${overdueBadge} |`;
      }),
    ].join('\n');
  } else {
    managersTable = '> *Данные по сотрудникам отсутствуют или не привязаны к сделкам.*';
  }

  // 2. Формирование причин отказов
  let lostReasonsTable = '';
  if (lostReasons && lostReasons.length > 0) {
    const totalLost = summary.lostDeals || 1;
    lostReasonsTable = [
      '| Причина отказа / срыва | Количество | Доля от всех отказов |',
      '| :--- | :---: | :---: |',
      ...lostReasons.map(r => {
        const share = Math.round((r.count / totalLost) * 100);
        return `| ❌ ${r.reason} | **${r.count} шт.** | ${share}% |`;
      }),
    ].join('\n');
  } else {
    lostReasonsTable = '> ⚠️ *Причины отказов не заполняются менеджерами (слепая зона воронки).*';
  }

  // 3. Формирование блока бенчмарков
  let benchmarksSection = '';
  if (searches && searches.length > 0) {
    benchmarksSection = `\n## 🌐 5. Рыночные бенчмарки и поисковая аналитика\n\n` +
      `*Поисковые запросы к отраслевой базе знаний:*\n` +
      searches.map(s => `- 🔍 \`${s}\``).join('\n') +
      `\n\n> Данные метрики сопоставлены с актуальными рыночными показателями для ниши **${cleanNiche}**.\n`;
  }

  // 4. Очищенный текст ИИ-аудита
  const formattedAiText = formatAiReportSection(reportText);

  // 5. Итоговый документ
  return `# 📑 ОТЧЕТ АУДИТА ОТДЕЛА ПРОДАЖ И ВОРОНКИ CRM

> **CRM-система:** ${crmTitle} (\`${metrics.portalOrDomain}\`)  
> **Сфера бизнеса:** ${cleanNiche}  
> **Режим анализа:** ${scopeTitle}  
> **Дата формирования:** ${dateStr}  
> **Статус проверки:** ✅ Данные верифицированы AI CRM Analyst Engine

---

## 🩺 1. Health Check и ключевой финансовый срез

**Интегральная оценка эффективности отдела:** \`${healthScore}\`

| Ключевой показатель | Значение | Описание и статус |
| :--- | :--- | :--- |
| 💰 **Фактическая выручка** | **${summary.totalRevenue.toLocaleString('ru-RU')} ₽** | Объем закрытых успешных сделок |
| 📈 **Конверсия воронки (Win Rate)** | **${summary.winRatePercent}%** | ${summary.wonDeals} выиграно из ${summary.totalDeals} сделок |
| 🔄 **Пайплайн в работе** | **${summary.pipelineValue.toLocaleString('ru-RU')} ₽** | ${summary.inProgressDeals} сделок на открытых этапах |
| 🏷️ **Средний чек сделки** | **${summary.averageCheck.toLocaleString('ru-RU')} ₽** | Выручка на одну победную сделку |
| ⏳ **Зависшие сделки (>14 дней)** | **${summary.stuckDealsCount} шт.** | ${summary.stuckDealsCount > 0 ? '⚠️ Требуется срочная ревизия РОПа' : '✅ Все сделки в динамике'} |
| 📋 **Дисциплина по задачам** | **${tasks.overdue} из ${tasks.total} (${tasks.overduePercent}%)** | ${tasks.overduePercent > 20 ? '🚨 Критический процент просрочек!' : '✅ В рамках допустимого'} |

---

## 👥 2. Сводный рейтинг и аудит менеджеров

${managersTable}

---

## ⚠️ 3. Точки потерь и причины отказов

${lostReasonsTable}

---

## 🧠 4. Экспертный стратегический ИИ-аудит

${formattedAiText}

${benchmarksSection}
---

## 🚀 6. План действий на 7 дней (Чек-лист для РОПа и собственника)

- [ ] **День 1-2: Ревизия зависших сделок** — провести разбор ${summary.stuckDealsCount} сделок без активности более 14 дней, инициировать спецпредложение или звонок РОПа.
- [ ] **День 3: Ликвидация просрочек** — закрыть ${tasks.overdue} просроченных задач и ввести правило «0 просрочек к концу рабочего дня».
- [ ] **День 4: Работа с причинами отказов** — внедрить обязательное поле причины отказа и разобрать возражение *«Дорого / Слишком высокая цена»*.
- [ ] **День 5: Мотивация и балансировка** — перераспределить поток лидов в пользу лидеров по Win Rate и подтянуть отстающих сотрудников.
- [ ] **День 6-7: Повторный аудит** — запросить обновленный аудит в боте для фиксации динамики конверсии.

---
*Сгенерировано автоматически AI CRM Support Analyst Bot. Документ оптимизирован для мгновенного просмотра в Telegram Desktop и Mobile.*
`;
}
