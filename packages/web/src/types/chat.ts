export interface ChatSession {
  id: string;
  title: string;
  directory: string;
  time: {
    created: number;
    updated: number;
  };
}

export interface MessageTokens {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}

export interface ChatMessage {
  info: {
    id: string;
    sessionID: string;
    role: 'user' | 'assistant';
    time: { created: number; completed?: number };
    /**
     * SDK UserMessage 持久化了发送时的 system 字段（即前端传入的 pageContext）。
     * 调试面板通过此字段回溯每条用户消息实际携带的上下文。
     */
    system?: string;
    /**
     * SDK AssistantMessage 携带的 token 消耗统计（仅 assistant 消息有值）。
     * 用于 token 用量监控。
     */
    tokens?: MessageTokens;
    /** 消息费用（仅 assistant 消息有值） */
    cost?: number;
  };
  parts: ChatPart[];
}

export interface ChatPart {
  id: string;
  type: string;
  text?: string;
  tool?: string;
  name?: string;
  reason?: string;
  messageID?: string;
  state?: {
    status: string;
    title?: string;
    input?: Record<string, unknown>;
    output?: string;
  };
  [key: string]: unknown;
}

export interface SSEEventPayload {
  type: string;
  properties: {
    part?: ChatPart;
    delta?: string;
    messageID?: string;
    partID?: string;
    field?: string;
    info?: {
      id: string;
      sessionID: string;
      role: 'user' | 'assistant';
      [key: string]: unknown;
    };
    sessionID?: string;
    status?: { type: string };
    [key: string]: unknown;
  };
}
