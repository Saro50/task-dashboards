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
  name: string;
  description?: string;
  mode: 'subagent' | 'primary' | 'all';
  builtIn: boolean;
  /** Agent 绑定的模型信息，用于查找模型能力 */
  model?: {
    modelID: string;
    providerID: string;
  };
  /** 运行时可能携带的隐藏标记（不在 SDK 类型中，但引擎会返回） */
  hidden?: boolean;
  /** 运行时可能携带的原生标记（不在 SDK 类型中，但引擎会返回） */
  native?: boolean;
}

/**
 * 模型能力描述（对应 SDK Model.capabilities）。
 * 上游：由 engineApi.listProviders 返回的 Provider.models 中提取。
 * 下游：用于 AIChatWidget 判断当前 agent 是否支持图片上传。
 */
export interface OpencodeModel {
  id: string;
  providerID: string;
  name: string;
  capabilities: {
    temperature: boolean;
    reasoning: boolean;
    attachment: boolean;
    toolcall: boolean;
    input: {
      text: boolean;
      audio: boolean;
      image: boolean;
      video: boolean;
      pdf: boolean;
    };
    output: {
      text: boolean;
      audio: boolean;
      image: boolean;
      video: boolean;
      pdf: boolean;
    };
  };
}

/**
 * Provider 信息（对应 SDK Provider 类型）。
 * models 为 Record<modelID, OpencodeModel> 格式。
 */
export interface OpencodeProvider {
  id: string;
  name: string;
  source: 'env' | 'config' | 'custom' | 'api';
  models: Record<string, OpencodeModel>;
}

export interface OpencodeProvidersResponse {
  providers: OpencodeProvider[];
  default: Record<string, string>;
}
