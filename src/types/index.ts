export type CRMType = 'bitrix24' | 'amocrm';

export type UserStep =
  | 'IDLE'
  | 'AWAITING_B24_WEBHOOK'
  | 'AWAITING_AMO_CREDENTIALS'
  | 'AWAITING_NICHE'
  | 'CHAT_WITH_AI';

export interface Bitrix24Credentials {
  webhookUrl: string;
}

export interface AmoCrmCredentials {
  domain: string;
  token: string;
}

export type CrmCredentials = Bitrix24Credentials | AmoCrmCredentials;

export interface StageStat {
  id: string;
  name: string;
  count: number;
  totalAmount: number;
  conversionFromPrevPercent?: number;
}

export interface PipelineStats {
  id: string;
  name: string;
  totalDeals: number;
  wonDeals: number;
  lostDeals: number;
  inProgressDeals: number;
  totalRevenue: number;
  pipelineValue: number;
  averageCheck: number;
  winRatePercent: number;
  stages: StageStat[];
}

export interface ManagerStat {
  id: string;
  name: string;
  dealsCount: number;
  wonDealsCount: number;
  lostDealsCount: number;
  totalRevenue: number;
  openTasksCount: number;
  overdueTasksCount: number;
  winRatePercent: number;
}

export interface BusinessMetrics {
  crmType: CRMType;
  portalOrDomain: string;
  collectedAt: string;
  summary: {
    totalDeals: number;
    wonDeals: number;
    lostDeals: number;
    inProgressDeals: number;
    totalRevenue: number;
    pipelineValue: number;
    averageCheck: number;
    winRatePercent: number;
    stuckDealsCount: number; // Сделки без движения >14 дней
  };
  lostReasons: Array<{ reason: string; count: number }>;
  pipelines: PipelineStats[];
  managers: ManagerStat[];
  tasks: {
    total: number;
    overdue: number;
    overduePercent: number;
  };
}

export interface UserSession {
  step: UserStep;
  crmType: CRMType | null;
  credentials: CrmCredentials | null;
  niche: string | null;
  metricsCache: BusinessMetrics | null;
  chatHistory: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface AIAgentResponse {
  text: string;
  modelUsed: string;
  searches: string[];
  isFallbackGenerated?: boolean;
}
