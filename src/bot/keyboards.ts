import { Markup } from 'telegraf';

export const Keyboards = {
  // Выбор CRM при первом входе или смене
  chooseCrm: Markup.inlineKeyboard([
    [Markup.button.callback('🟦 Подключить Битрикс24', 'connect_bitrix')],
    [Markup.button.callback('🟧 Подключить amoCRM', 'connect_amocrm')],
    [Markup.button.callback('✨ Запустить с демо-данными CRM', 'use_demo_data')],
  ]),

  // Главное аналитическое меню
  mainMenu: (hasMetrics: boolean = false) =>
    Markup.inlineKeyboard([
      [Markup.button.callback('🚀 Полный ИИ-аудит бизнеса', 'action_full_audit')],
      [
        Markup.button.callback('📊 Экспресс-дашборд', 'action_dashboard'),
        Markup.button.callback('👥 Аудит команды', 'action_managers'),
      ],
      [Markup.button.callback('🔍 Бенчмарки рынка (Web Search)', 'action_benchmarks')],
      [Markup.button.callback('💬 Задать вопрос ИИ-консультанту', 'action_chat_ai')],
      [
        Markup.button.callback('🏢 Сменить нишу', 'action_set_niche'),
        Markup.button.callback('🔄 Сменить CRM', 'action_change_crm'),
      ],
    ]),

  // Навигация назад в главное меню
  backToMenu: Markup.inlineKeyboard([
    [Markup.button.callback('⬅️ В главное меню', 'nav_main_menu')],
  ]),

  // Кнопки после получения отчета
  afterAuditMenu: Markup.inlineKeyboard([
    [Markup.button.callback('💬 Задать вопрос по отчету', 'action_chat_ai')],
    [Markup.button.callback('📊 Обновить метрики из CRM', 'action_refresh_metrics')],
    [Markup.button.callback('⬅️ В главное меню', 'nav_main_menu')],
  ]),
};
