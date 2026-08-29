import { createBot } from './bot/bot';
import { config } from './config';

async function bootstrap() {
  console.log('----------------------------------------------------');
  console.log('🤖 Запуск ИИ-Бизнес Аналитика для CRM (TypeScript)...');
  console.log(`📡 OpenRouter Base URL: ${config.openRouterBaseUrl}`);
  console.log(`🔄 Список каскадных моделей (${config.models.length}):`);
  config.models.forEach((m, idx) => console.log(`   ${idx + 1}. ${m}`));
  if (config.proxyUrl) {
    console.log(`🌐 Прокси-сервер настроен: ${config.proxyUrl}`);
  }
  console.log('----------------------------------------------------');

  try {
    const bot = createBot();

    // Запуск polling
    bot.launch(() => {
      console.log('✅ Telegram-бот успешно запущен и ожидает сообщений!');
    });

    // Обработка сигналов остановки
    process.once('SIGINT', () => {
      console.log('🛑 Получен сигнал SIGINT. Остановка бота...');
      bot.stop('SIGINT');
    });
    process.once('SIGTERM', () => {
      console.log('🛑 Получен сигнал SIGTERM. Остановка бота...');
      bot.stop('SIGTERM');
    });
  } catch (error: any) {
    console.error('❌ Критическая ошибка при старте бота:', error.message);
    process.exit(1);
  }
}

bootstrap();
