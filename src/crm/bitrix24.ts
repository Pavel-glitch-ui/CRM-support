import axios from 'axios';
import { config } from '../config';

export interface BitrixRawData {
  deals: any[];
  leads: any[];
  stages: any[];
  categories: any[];
  tasks: any[];
  users: any[];
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
    const axiosOptions: any = {
      timeout: 15000,
    };
    if (config.proxyAgent) {
      axiosOptions.httpsAgent = config.proxyAgent;
      axiosOptions.httpAgent = config.proxyAgent;
    }

    const url = `${this.webhookUrl}${method}.json`;
    const response = await axios.post(url, data, axiosOptions);
    return response.data?.result;
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
   * Сбор полного датасета из Битрикс24 для аудита
   */
  public async fetchAllData(): Promise<BitrixRawData> {
    const [dealsRes, stagesRes, categoriesRes, tasksRes, usersRes] = await Promise.allSettled([
      // Сделки
      this.request('crm.deal.list', {
        order: { DATE_CREATE: 'DESC' },
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
        limit: 50,
      }),
      // Стадии сделок
      this.request('crm.status.list', {
        filter: { ENTITY_ID: 'DEAL_STAGE' },
      }),
      // Направления / Воронки
      this.request('crm.dealcategory.list', {}),
      // Задачи
      this.request('tasks.task.list', {
        order: { DEADLINE: 'ASC' },
        select: ['ID', 'TITLE', 'RESPONSIBLE_ID', 'STATUS', 'DEADLINE', 'CREATED_DATE'],
        limit: 50,
      }),
      // Пользователи / Сотрудники
      this.request('user.get', {
        ACTIVE: 'Y',
      }),
    ]);

    const deals = dealsRes.status === 'fulfilled' && Array.isArray(dealsRes.value) ? dealsRes.value : [];
    const stages = stagesRes.status === 'fulfilled' && Array.isArray(stagesRes.value) ? stagesRes.value : [];
    const categories = categoriesRes.status === 'fulfilled' && Array.isArray(categoriesRes.value) ? categoriesRes.value : [];
    const tasks = tasksRes.status === 'fulfilled' && Array.isArray(tasksRes.value?.tasks) ? tasksRes.value.tasks : [];
    const users = usersRes.status === 'fulfilled' && Array.isArray(usersRes.value) ? usersRes.value : [];

    return {
      deals,
      leads: [],
      stages,
      categories,
      tasks,
      users,
    };
  }
}
