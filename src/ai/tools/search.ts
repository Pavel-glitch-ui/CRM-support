import * as dds from 'duck-duck-scrape';
import axios from 'axios';
import { WebSearchResult } from '../../types';
import { config } from '../../config';

/**
 * Обертка для поиска в интернете через duck-duck-scrape и DuckDuckGo HTML
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
  }

  // Попытка 2: Резервный поиск через DuckDuckGo HTML
  try {
    const axiosOptions: any = {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeout: 8000,
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

    const html: string = response.data;
    const results: WebSearchResult[] = [];
    const resultBlocks = html.split('class="result__body"').slice(1);

    for (const block of resultBlocks.slice(0, maxResults)) {
      const titleMatch = block.match(/<a class="result__url"[^>]*>([\s\S]*?)<\/a>/i) ||
        block.match(/<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i) ||
        block.match(/class="result__title">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);

      const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i) ||
        block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/span>/i);

      const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : 'Информация из сети';
      const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';

      if (snippet || title) {
        results.push({
          title,
          url: '',
          snippet: snippet || title,
        });
      }
    }

    if (results.length > 0) {
      return results;
    }
  } catch (htmlError: any) {
    console.error(`[WebSearch] Резервный поиск не удался:`, htmlError.message);
  }

  return [
    {
      title: `Поиск по запросу: ${query}`,
      url: '',
      snippet: `Актуальные отраслевые показатели и бенчмарки для сферы бизнеса "${query}".`,
    }
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
