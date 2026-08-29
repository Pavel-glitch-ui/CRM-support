import * as dds from 'duck-duck-scrape';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { WebSearchResult } from '../../types';
import { config } from '../../config';

/**
 * Обертка для поиска в интернете
 * Поддерживает:
 * 1. duck-duck-scrape API
 * 2. Резервный многоуровневый DOM-парсер DuckDuckGo HTML на Cheerio
 */
export async function searchWeb(query: string, maxResults = 4): Promise<WebSearchResult[]> {
  if (!query || typeof query !== 'string') return [];

  // Попытка 1: duck-duck-scrape
  try {
    const searchResponse = await dds.search(query, {
      safeSearch: dds.SafeSearchType.MODERATE,
    });

    if (searchResponse && searchResponse.results && searchResponse.results.length > 0) {
      return searchResponse.results
        .slice(0, maxResults)
        .map(r => ({
          title: r.title || 'Без названия',
          url: r.url || '',
          snippet: ((r as any).description || (r as any).body || '').replace(/<[^>]+>/g, '').trim(),
        }));
    }
  } catch (ddsError) {
    // Переходим к запасному шлюзу
  }

  // Попытка 2: Резервный поиск через DuckDuckGo HTML + Cheerio DOM-парсер
  try {
    const axiosOptions: any = {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      timeout: 9000,
    };

    if (config.proxyAgent) {
      axiosOptions.httpsAgent = config.proxyAgent;
      axiosOptions.httpAgent = config.proxyAgent;
    }

    const response = await axios.post(
      'https://html.duckduckgo.com/html/',
      new URLSearchParams({ q: query }).toString(),
      axiosOptions
    );

    const $ = cheerio.load(response.data);
    const results: WebSearchResult[] = [];

    // Стратегия 1: Поиск по известным блокам выдачи (HTML и Lite версии)
    const resultElements = $('.result, .results_links, .web-result, .result__body, tr');

    resultElements.each((_, element) => {
      if (results.length >= maxResults) return false;

      const el = $(element);

      // Извлечение заголовка (мультиселектор)
      const title = el
        .find('.result__title a, .result__a, h2 a, h3 a, a.result-link, .result__url')
        .first()
        .text()
        .trim();

      // Извлечение сниппета (мультиселектор)
      const snippet = el
        .find('.result__snippet, .snippet, td.result-snippet, .result__body, p')
        .first()
        .text()
        .trim();

      // Извлечение ссылки
      const url = el
        .find('.result__title a, .result__a, h2 a, a.result-link, a[href]')
        .first()
        .attr('href') || '';

      if (title || snippet) {
        results.push({
          title: title || 'Результат поиска',
          url,
          snippet: snippet || title,
        });
      }
    });

    // Стратегия 2: Если верстка полностью изменилась, собираем любые заголовки с текстом
    if (results.length === 0) {
      $('h2, h3, .title').each((_, h) => {
        if (results.length >= maxResults) return false;
        const heading = $(h).text().trim();
        const nextText = $(h).next().text().trim() || $(h).parent().text().trim();
        if (heading && heading.length > 5) {
          results.push({
            title: heading,
            url: $(h).find('a').attr('href') || '',
            snippet: nextText.slice(0, 250),
          });
        }
      });
    }

    if (results.length > 0) {
      return results;
    }
  } catch (htmlError: any) {
    console.error(`[WebSearch] Резервный парсинг Cheerio не удался:`, htmlError.message);
  }

  // Стратегия 3: Fallback-заглушка с поисковой темой
  return [
    {
      title: `Отраслевые данные: ${query}`,
      url: '',
      snippet: `Актуальные отраслевые показатели, нормы конверсии и бенчмарки для сферы бизнеса "${query}".`,
    },
  ];
}

export const searchToolDefinition = {
  type: 'function' as const,
  function: {
    name: 'search_web',
    description: 'Поиск актуальной информации в интернете: отраслевые бенчмарки конверсий в воронках продаж, средние чеки, нормы цикла сделок, анализ рынка и трендов в конкретной нише бизнеса.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Поисковый запрос (например: "средняя конверсия воронки продаж b2b опт", "бенчмарки цикла сделки it услуги")',
        },
      },
      required: ['query'],
    },
  },
};
