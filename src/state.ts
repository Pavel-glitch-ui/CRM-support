import { UserSession, CRMType, CrmCredentials, BusinessMetrics, UserStep } from './types';

class StateManager {
  private sessions: Map<string, UserSession> = new Map();

  public get(chatId: string | number): UserSession {
    const id = String(chatId);
    if (!this.sessions.has(id)) {
      this.sessions.set(id, {
        step: 'IDLE',
        crmType: null,
        credentials: null,
        niche: null,
        metricsCache: null,
        lastAuditReport: null,
        chatHistory: [],
      });
    }
    return this.sessions.get(id)!;
  }

  public set(chatId: string | number, data: Partial<UserSession>): UserSession {
    const id = String(chatId);
    const current = this.get(id);
    const updated = { ...current, ...data };
    this.sessions.set(id, updated);
    return updated;
  }

  public setStep(chatId: string | number, step: UserStep): void {
    this.set(chatId, { step });
  }

  public setCrm(chatId: string | number, crmType: CRMType, credentials: CrmCredentials): void {
    this.set(chatId, {
      crmType,
      credentials,
      step: 'IDLE',
      metricsCache: null,
      lastAuditReport: null,
    });
  }

  public setNiche(chatId: string | number, niche: string): void {
    this.set(chatId, { niche });
  }

  public setMetrics(chatId: string | number, metrics: BusinessMetrics): void {
    this.set(chatId, { metricsCache: metrics });
  }

  public setLastAuditReport(
    chatId: string | number,
    report: { text: string; searches: string[]; scope: 'recent' | 'full'; createdAt: string }
  ): void {
    this.set(chatId, { lastAuditReport: report });
  }

  public appendChat(chatId: string | number, role: 'user' | 'assistant', content: string): void {
    const session = this.get(chatId);
    const history = [...session.chatHistory, { role, content }];
    // Ограничиваем историю последними 10 сообщениями
    if (history.length > 10) {
      history.splice(0, history.length - 10);
    }
    this.set(chatId, { chatHistory: history });
  }

  public reset(chatId: string | number): UserSession {
    const id = String(chatId);
    const cleanSession: UserSession = {
      step: 'IDLE',
      crmType: null,
      credentials: null,
      niche: null,
      metricsCache: null,
      lastAuditReport: null,
      chatHistory: [],
    };
    this.sessions.set(id, cleanSession);
    return cleanSession;
  }

  public isConnected(chatId: string | number): boolean {
    const session = this.get(chatId);
    return Boolean(session.crmType && session.credentials);
  }
}

export const state = new StateManager();
