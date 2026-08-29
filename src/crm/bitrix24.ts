import axios from 'axios';
import { config } from '../config';

export interface BitrixRawData {
  deals: any[];
  leads: any[];
  stages: any[];
  categories: any[];
  tasks: any[];
  users: any[];
  totalDealsInCrm?: number;
}

export class Bitrix24Client {
  private webhookUrl: string;

  constructor(webhookUrl: string) {
    let cleanUrl = webhookUrl.trim();
    if (!cleanUrl.endsWith('/')) {
      cleanUrl += '/';
    }
    this.webhookUrl = cleanUrl;
  }

  private async request(method: string, data: any = {}) {
    const res = await this.requestFull(method, data);
    return res?.result;
  }

  private async requestFull(method: string, data: any = {}) {
    const axiosOptions: any = {
      timeout: 20000,
    };
    if (config.proxyAgent) {
      axiosOptions.httpsAgent = config.proxyAgent;
      axiosOptions.httpAgent = config.proxyAgent;
    }

    const url = `${this.webhookUrl}${method}.json`;
    const response = await axios.post(url, data, axiosOptions);
    return response.data;
  }

  /**
   * Проверка валидности вебхука
   */
  public async testConnection(): Promise<boolean> {
    try {
      await this.request('crm.lead.list', { order: { ID: 'DESC' }, select: ['ID'], limit: 1 });
      return true;
    } catch (e) {
      try {
        await this.request('app.info');
        return true;
      } catch (err) {
        return false;
      }
    }
  }

  /**
   * Выгрузка справочников (стадии, воронки, пользователи, задачи)
   */
  private async fetchMeta() {
    const [stagesRes, categoriesRes, tasksRes, usersRes] = await Promise.allSettled([
      this.request('crm.status.list', { filter: { ENTITY_ID: 'DEAL_STAGE' } }),
      this.request('crm.dealcategory.list', {}),
      this.request('tasks.task.list', {
        order: { DEADLINE: 'ASC' },
        select: ['ID', 'TITLE', 'RESPONSIBLE_ID', 'STATUS', 'DEADLINE', 'CREATED_DATE'],
        limit: 50,
      }),
      this.request('user.get', { ACTIVE: 'Y' }),
    ]);

    const stages = stagesRes.status === 'fulfilled' && Array.isArray(stagesRes.value) ? stagesRes.value : [];
    const categories = categoriesRes.status === 'fulfilled' && Array.isArray(categoriesRes.value) ? categoriesRes.value : [];
    const tasks = tasksRes.status === 'fulfilled' && Array.isArray(tasksRes.value?.tasks) ? tasksRes.value.tasks : [];
    const users = usersRes.status === 'fulfilled' && Array.isArray(usersRes.value) ? usersRes.value : [];

    return { stages, categories, tasks, users };
  }

  /**
   * 1. Экспресс-выборка: 50 последних измененных сделок (DATE_MODIFY DESC)
   */
  public async fetchRecentData(limit = 50): Promise<BitrixRawData> {
    const [dealsRes, meta] = await Promise.all([
      this.requestFull('crm.deal.list', {
        order: { DATE_MODIFY: 'DESC' },
        select: [
          'ID',
          'TITLE',
          'STAGE_ID',
          'CATEGORY_ID',
          'OPPORTUNITY',
          'CURRENCY_ID',
          'DATE_CREATE',
          'DATE_MODIFY',
          'CLOSED',
          'ASSIGNED_BY_ID',
        ],
        limit,
      }),
      this.fetchMeta(),
    ]);

    const deals = Array.isArray(dealsRes?.result) ? dealsRes.result : [];
    const totalDealsInCrm = typeof dealsRes?.total === 'number' ? dealsRes.total : deals.length;

    return {
      deals,
      leads: [],
      stages: meta.stages,
      categories: meta.categories,
      tasks: meta.tasks,
      users: meta.users,
      totalDealsInCrm,
    };
  }

  /**
   * 2. Потоковая выгрузка всей базы чанками по 50 записей с пагинацией
   */
  public async fetchChunkedData(
    onProgress?: (loadedCount: number, totalCount: number | null, chunkIndex: number) => Promise<void> | void,
    maxDeals = 500
  ): Promise<BitrixRawData> {
    const meta = await this.fetchMeta();
    const allDeals: any[] = [];
    let start = 0;
    let chunkIndex = 1;
    let totalCount: number | null = null;

    while (start !== null && allDeals.length < maxDeals) {
      const pageRes = await this.requestFull('crm.deal.list', {
        order: { DATE_MODIFY: 'DESC' },
        select: [
          'ID',
          'TITLE',
          'STAGE_ID',
          'CATEGORY_ID',
          'OPPORTUNITY',
          'CURRENCY_ID',
          'DATE_CREATE',
          'DATE_MODIFY',
          'CLOSED',
          'ASSIGNED_BY_ID',
        ],
        start,
      });

      const pageDeals = Array.isArray(pageRes?.result) ? pageRes.result : [];
      if (pageDeals.length === 0) break;

      allDeals.push(...pageDeals);

      if (typeof pageRes?.total === 'number') {
        totalCount = pageRes.total;
      }

      if (onProgress) {
        await onProgress(allDeals.length, totalCount, chunkIndex);
      }

      // Проверяем наличие следующей страницы
      if (pageRes?.next && typeof pageRes.next === 'number') {
        start = pageRes.next;
        chunkIndex++;
        // Небольшая задержка для соблюдения rate limits (2 req/sec)
        await new Promise((r) => setTimeout(r, 250));
      } else {
        break;
      }
    }

    return {
      deals: allDeals,
      leads: [],
      stages: meta.stages,
      categories: meta.categories,
      tasks: meta.tasks,
      users: meta.users,
      totalDealsInCrm: totalCount || allDeals.length,
    };
  }

  /**
   * Метод совместимости
   */
  public async fetchAllData(): Promise<BitrixRawData> {
    return this.fetchRecentData(50);
  }
}
