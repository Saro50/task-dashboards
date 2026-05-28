declare module '@opencode-ai/sdk' {
  interface SessionInfo {
    id: string;
    projectID: string;
    directory: string;
    parentID?: string;
    title: string;
    version: string;
    time: {
      created: number;
      updated: number;
      compacting?: number;
    };
  }

  interface UserMessage {
    id: string;
    sessionID: string;
    role: 'user';
    time: { created: number };
    agent: string;
    model: { providerID: string; modelID: string };
  }

  interface AssistantMessage {
    id: string;
    sessionID: string;
    role: 'assistant';
    time: { created: number; completed?: number };
    parentID: string;
    modelID: string;
    providerID: string;
    mode: string;
    cost: number;
    tokens: {
      input: number;
      output: number;
      reasoning: number;
      cache: { read: number; write: number };
    };
    finish?: string;
  }

  type Message = UserMessage | AssistantMessage;

  interface TextPart {
    id: string;
    sessionID: string;
    messageID: string;
    type: 'text';
    text: string;
    time?: { start: number; end?: number };
  }

  interface ToolPart {
    id: string;
    sessionID: string;
    messageID: string;
    type: 'tool';
    callID: string;
    tool: string;
    state: {
      status: 'pending' | 'running' | 'completed' | 'error';
      input: Record<string, unknown>;
      title?: string;
      output?: string;
      time?: { start: number; end: number };
    };
  }

  type Part = TextPart | ToolPart | { id: string; sessionID: string; messageID: string; type: string; [key: string]: unknown };

  interface SessionStatus {
    type: 'idle' | 'busy' | 'retry';
  }

  interface GlobalEvent {
    directory: string;
    type?: string;
    payload?: Event;
    properties?: Record<string, unknown>;
    [key: string]: unknown;
  }

  interface EventMessagePartUpdated {
    type: 'message.part.updated';
    properties: {
      part: Part;
      delta?: string;
    };
  }

  interface EventMessageUpdated {
    type: 'message.updated';
    properties: {
      info: Message;
    };
  }

  interface EventSessionStatus {
    type: 'session.status';
    properties: {
      sessionID: string;
      status: SessionStatus;
    };
  }

  interface EventSessionCreated {
    type: 'session.created';
    properties: {
      info: SessionInfo;
    };
  }

  type Event =
    | EventMessagePartUpdated
    | EventMessageUpdated
    | EventSessionStatus
    | EventSessionCreated
    | { type: string; properties?: Record<string, unknown> };

  interface ServerSentEventsResult<T> {
    stream: AsyncGenerator<T>;
  }

  interface OpencodeClient {
    app: {
      agents(): Promise<{ data: Array<{ id: string; name: string; description?: string }> }>;
    };
    config: {
      get(): Promise<{ data: Record<string, unknown> }>;
      providers(): Promise<{ data: { providers: Array<{ id: string; name: string; models: Record<string, unknown> }>; default: Record<string, string> } }>;
    };
    session: {
      list(options?: { query?: { directory?: string } }): Promise<{ data: SessionInfo[] }>;
      create(options?: { body?: { title?: string }; query?: { directory?: string } }): Promise<{ data: SessionInfo }>;
      messages(options: { path: { id: string }; query?: { directory?: string } }): Promise<{ data: Array<{ info: Message; parts: Part[] }> }>;
      prompt(options: { path: { id: string }; body: { parts: Array<{ type: 'text'; text: string }> }; query?: { directory?: string } }): Promise<{ data: { info: AssistantMessage; parts: Part[] } }>;
      promptAsync(options: { path: { id: string }; body: { parts: Array<{ type: 'text'; text: string }> }; query?: { directory?: string } }): Promise<{ data: void }>;
      abort(options: { path: { id: string }; query?: { directory?: string } }): Promise<{ data: boolean }>;
      status(options?: { query?: { directory?: string } }): Promise<{ data: Record<string, SessionStatus> }>;
    };
    event: {
      subscribe(options?: { query?: { directory?: string } }): Promise<ServerSentEventsResult<GlobalEvent>>;
    };
  }

  export function createOpencodeClient(options: { baseUrl: string }): OpencodeClient;
}
