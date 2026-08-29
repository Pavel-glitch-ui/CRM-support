import dotenv from 'dotenv';

dotenv.config();

const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY || '';

let proxyAgent: any = undefined;
if (proxyUrl) {
  try {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    proxyAgent = new HttpsProxyAgent(proxyUrl);
  } catch (e) {
    console.warn('[Config] Не удалось инициализировать https-proxy-agent:', (e as any).message);
  }
}

export const config = {
  botToken: process.env.BOT_TOKEN || '',
  openRouterApiKey: process.env.OPEN_ROUTER_AI_TOKEN || '',
  openRouterBaseUrl: process.env.OPEN_ROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  proxyUrl,
  proxyAgent,

  // Каскадный список бесплатных моделей OpenRouter (fallback chain)
  models: [
    'inclusionai/ling-3.0-flash-fin:free',
    'z-ai/glm-5.2:free',
    'minimax/minimax-m3:free'
  ],

  search: {
    maxResults: 4,
  },
};
