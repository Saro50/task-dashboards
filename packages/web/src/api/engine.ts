import { apiRequest } from '@/api/lib';
import type {
  EngineConfig,
  EngineConfigUpsertInput,
  OpencodeHealth,
  OpencodeAgent,
  OpencodeProvidersResponse,
} from '@/types/engine';

const BASE = '/api/engine';
const S = 'engineApi';

export const engineApi = {
  getConfig(): Promise<EngineConfig> {
    return apiRequest<EngineConfig>(S, `${BASE}/config`);
  },
  upsertConfig(input: EngineConfigUpsertInput): Promise<EngineConfig> {
    return apiRequest<EngineConfig>(S, `${BASE}/config`, { method: 'PUT', body: JSON.stringify(input) });
  },
  removeConfig(): Promise<void> {
    return apiRequest<void>(S, `${BASE}/config`, { method: 'DELETE' });
  },
  healthCheck(): Promise<OpencodeHealth> {
    return apiRequest<OpencodeHealth>(S, `${BASE}/health`);
  },
  listAgents(): Promise<OpencodeAgent[]> {
    return apiRequest<OpencodeAgent[]>(S, `${BASE}/agents`);
  },
  listProviders(): Promise<OpencodeProvidersResponse> {
    return apiRequest<OpencodeProvidersResponse>(S, `${BASE}/providers`);
  },
};
