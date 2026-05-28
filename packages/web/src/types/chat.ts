export interface ChatSession {
  id: string;
  title: string;
  directory: string;
  time: {
    created: number;
    updated: number;
  };
}

export interface ChatMessage {
  info: {
    id: string;
    sessionID: string;
    role: 'user' | 'assistant';
    time: { created: number; completed?: number };
  };
  parts: ChatPart[];
}

export interface ChatPart {
  id: string;
  type: string;
  text?: string;
  state?: {
    status: string;
    title?: string;
    output?: string;
  };
  [key: string]: unknown;
}

export interface SSEEventPayload {
  type: string;
  properties: {
    part?: ChatPart;
    delta?: string;
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
