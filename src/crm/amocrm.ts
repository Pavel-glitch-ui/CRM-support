import axios from 'axios';
import { config } from '../config';

export interface AmoRawData {
  leads: any[];
  pipelines: any[];
  tasks: any[];
  users: any[];
  accountInfo: any;
  totalDealsInCrm?: number;
}

export class AmoCrmClient {
  private baseUrl: string;
  private token: string;

  constructor(domain: string, token: string) {
    let cleanDomain = domain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!cleanDomain.includes('.')) {
      cleanDomain = `${cleanDomain}.amocrm.ru`;
    }
    this.baseUrl = `https://${cleanDomain}/api/v4`;
    this.token = token.trim();
  }

  private async request(endpoint: string, params: any = {}) {
    const axiosOptions: any = {
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      params,
      timeout: 20000,
    };

    if (config.proxyAgent) {
      axiosOptions.httpsAgent = config.proxyAgent;
      axiosOptions.httpAgent = config.proxyAgent;
    }

    const response = await axios.get(`${this.baseUrl}${endpoint}`, axiosOptions);
    return response.data;
  }

  /**
   * Проверка подключения к amoCRM
   */
  public async testConnection(): Promise<boolean> {
    try {
      await this.request('/account');
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Выгрузка справочников (аккаунт, воронки, задачи, пользователи)
   */
  private async fetchMeta() {
    const [accountRes, pipelinesRes, tasksRes, usersRes] = await Promise.allSettled([
      this.request('/account'),
      this.request('/leads/pipelines'),
      this.request('/tasks', { limit: 50 }),
      this.request('/users', { limit: 50 }),
    ]);

    const accountInfo = accountRes.status === 'fulfilled' ? accountRes.value : null;
    const pipelines = pipelinesRes.status === 'fulfilled' && pipelinesRes.value?._embedded?.pipelines ? pipelinesRes.value._embedded.pipelines : [];
    const tasks = tasksRes.status === 'fulfilled' && tasksRes.value?._embedded?.tasks ? tasksRes.value._embedded.tasks : [];
    const users = usersRes.status === 'fulfilled' && usersRes.value?._embedded?.users ? usersRes.value._embedded.users : [];

    return { accountInfo, pipelines, tasks, users };
  }

  /**
   * 1. Экспресс-выборка: 50 последних измененных сделок (order[updated_at]=desc)
   */
  public async fetchRecentData(limit = 50): Promise<AmoRawData> {
    const [leadsRes, meta] = await Promise.all([
      this.request('/leads', {
        limit,
        'order[updated_at]': 'desc',
        with: 'loss_reason',
      }).catch(() => null),
      this.fetchMeta(),
    ]);

    const leads = leadsRes?._embedded?.leads || [];

    return {
      accountInfo: meta.accountInfo,
      leads,
      pipelines: meta.pipelines,
      tasks: meta.tasks,
      users: meta.users,
      totalDealsInCrm: leads.length,
    };
  }

  /**
   * 2. Потоковая выгрузка всей базы чанками (пагинация по page)
   */
  public async fetchChunkedData(
    onProgress?: (loadedCount: number, totalCount: number | null, chunkIndex: number) => Promise<void> | void,
    maxDeals = 500
  ): Promise<AmoRawData> {
    const meta = await this.fetchMeta();
    const allLeads: any[] = [];
    let page = 1;
    const limit = 50;

    while (allLeads.length < maxDeals) {
      try {
        const leadsRes = await this.request('/leads', {
          page,
          limit,
          'order[updated_at]': 'desc',
          with: 'loss_reason',
        });

        const pageLeads = leadsRes?._embedded?.leads || [];
        if (pageLeads.length === 0) break;

        allLeads.push(...pageLeads);

        if (onProgress) {
          await onProgress(allLeads.length, null, page);
        }

        // Если пришло меньше limit записей, значит это последняя страница
        if (pageLeads.length < limit || !leadsRes?._links?.next) {
          break;
        }

        page++;
        // Небольшая задержка (200ms) для соблюдения лимитов amoCRM (до 7 req/sec)
        await new Promise((r) => setTimeout(r, 200));
      } catch (error: any) {
        // 204 No Content в amoCRM означает отсутствие данных на запрошенной странице
        if (error.response?.status === 204) {
          break;
        }
        console.warn(`[amoCRM Pagination] Ошибка на странице ${page}:`, error.message);
        break;
      }
    }

    return {
      accountInfo: meta.accountInfo,
      leads: allLeads,
      pipelines: meta.pipelines,
      tasks: meta.tasks,
      users: meta.users,
      totalDealsInCrm: allLeads.length,
    };
  }

  /**
   * Метод совместимости
   */
  public async fetchAllData(): Promise<AmoRawData> {
    return this.fetchRecentData(50);
  }
}
