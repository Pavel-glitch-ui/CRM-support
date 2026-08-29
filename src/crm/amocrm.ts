import axios from 'axios';
import { config } from '../config';

export interface AmoRawData {
  leads: any[];
  pipelines: any[];
  tasks: any[];
  users: any[];
  accountInfo: any;
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
      timeout: 15000,
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
   * Сбор полного датасета из amoCRM
   */
  public async fetchAllData(): Promise<AmoRawData> {
    const [accountRes, leadsRes, pipelinesRes, tasksRes, usersRes] = await Promise.allSettled([
      this.request('/account'),
      this.request('/leads', {
        limit: 50,
        with: 'loss_reason',
      }),
      this.request('/leads/pipelines'),
      this.request('/tasks', { limit: 50 }),
      this.request('/users', { limit: 50 }),
    ]);

    const accountInfo = accountRes.status === 'fulfilled' ? accountRes.value : null;
    const leads = leadsRes.status === 'fulfilled' && leadsRes.value?._embedded?.leads ? leadsRes.value._embedded.leads : [];
    const pipelines = pipelinesRes.status === 'fulfilled' && pipelinesRes.value?._embedded?.pipelines ? pipelinesRes.value._embedded.pipelines : [];
    const tasks = tasksRes.status === 'fulfilled' && tasksRes.value?._embedded?.tasks ? tasksRes.value._embedded.tasks : [];
    const users = usersRes.status === 'fulfilled' && usersRes.value?._embedded?.users ? usersRes.value._embedded.users : [];

    return {
      accountInfo,
      leads,
      pipelines,
      tasks,
      users,
    };
  }
}
