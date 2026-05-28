import type {
  EngineConfig,
  EngineConfigUpsertInput,
  OpencodeHealth,
  OpencodeAgent,
  OpencodeProvidersResponse,
} from '@/types/engine';

const BASE = '/api/engine';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const engineApi = {
  getConfig(): Promise<EngineConfig> {
    return request<EngineConfig>(`${BASE}/config`);
  },
  upsertConfig(input: EngineConfigUpsertInput): Promise<EngineConfig> {
    return request<EngineConfig>(`${BASE}/config`, { method: 'PUT', body: JSON.stringify(input) });
  },
  removeConfig(): Promise<void> {
    return request<void>(`${BASE}/config`, { method: 'DELETE' });
  },
  healthCheck(): Promise<OpencodeHealth> {
    return request<OpencodeHealth>(`${BASE}/health`);
  },
  listAgents(): Promise<OpencodeAgent[]> {
    return request<OpencodeAgent[]>(`${BASE}/agents`);
  },
  listProviders(): Promise<OpencodeProvidersResponse> {
    return request<OpencodeProvidersResponse>(`${BASE}/providers`);
  },
};
