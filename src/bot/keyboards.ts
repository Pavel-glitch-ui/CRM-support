import { Markup } from 'telegraf';

export const Keyboards = {
  // Выбор CRM при первом входе или смене
  chooseCrm: Markup.inlineKeyboard([
    [Markup.button.callback('🟦 Подключить Битрикс24', 'connect_bitrix')],
    [Markup.button.callback('🟧 Подключить amoCRM', 'connect_amocrm')],
    [Markup.button.callback('✨ Запустить с демо-данными CRM', 'use_demo_data')],
  ]),

  // Главное аналитическое меню
  mainMenu: (hasMetrics: boolean = false) => {
    const buttons = [
      [
        Markup.button.callback('⚡ Экспресс-аудит (последние 50)', 'action_recent_audit'),
      ],
      [
        Markup.button.callback('🚀 Полный аудит всей базы (Chunked)', 'action_full_stream_audit'),
      ],
      [
        Markup.button.callback('📊 Экспресс-дашборд', 'action_dashboard'),
        Markup.button.callback('👥 Аудит команды', 'action_managers'),
      ],
      [Markup.button.callback('🔍 Бенчмарки рынка (Web Search)', 'action_benchmarks')],
      [Markup.button.callback('💬 Задать вопрос ИИ-консультанту', 'action_chat_ai')],
    ];

    if (hasMetrics) {
      buttons.push([
        Markup.button.callback('📥 Скачать сводку данных (.md)', 'action_export_md'),
        Markup.button.callback('📄 Скачать отчет (PDF)', 'action_download_pdf'),
      ]);
    }

    buttons.push([
      Markup.button.callback('🏢 Сменить нишу', 'action_set_niche'),
      Markup.button.callback('🔄 Сменить CRM', 'action_change_crm'),
    ]);

    return Markup.inlineKeyboard(buttons);
  },

  // Навигация назад в главное меню
  backToMenu: Markup.inlineKeyboard([
    [Markup.button.callback('⬅️ В главное меню', 'nav_main_menu')],
  ]),

  // Кнопки после получения отчета
  afterAuditMenu: Markup.inlineKeyboard([
    [
      Markup.button.callback('⚡ Скачать полный отчет (.md)', 'action_export_md'),
      Markup.button.callback('📄 Скачать PDF-отчет', 'action_download_pdf'),
    ],
    [Markup.button.callback('💬 Задать вопрос по отчету', 'action_chat_ai')],
    [Markup.button.callback('📊 Обновить метрики из CRM', 'action_refresh_metrics')],
    [Markup.button.callback('⬅️ В главное меню', 'nav_main_menu')],
  ]),
};
