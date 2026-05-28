export interface EngineConfig {
  id: string;
  baseUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface EngineConfigUpsertInput {
  baseUrl: string;
}

export interface OpencodeHealth {
  healthy: boolean;
}

export interface OpencodeAgent {
  id: string;
  name: string;
  description?: string;
}

export interface OpencodeProvider {
  id: string;
  name: string;
  models: string[];
}

export interface OpencodeProvidersResponse {
  providers: OpencodeProvider[];
  default: Record<string, string>;
}
