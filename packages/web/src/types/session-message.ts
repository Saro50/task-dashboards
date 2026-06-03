export type SessionMessageUser = {
  id: string;
  type: 'user';
  text: string;
  time: { created: number };
};

export type AssistantText = { type: 'text'; text: string };
export type AssistantReasoning = { type: 'reasoning'; id: string; text: string };

export type ToolState =
  | { status: 'pending'; input: string }
  | { status: 'running'; input: Record<string, unknown>; content: Array<{ type: string; text?: string }> }
  | { status: 'completed'; input: Record<string, unknown>; content: Array<{ type: string; text?: string }>; structured: Record<string, unknown> }
  | { status: 'error'; input: Record<string, unknown>; error: { message: string } };

export type AssistantTool = {
  type: 'tool';
  id: string;
  name: string;
  state: ToolState;
  time: { created: number; ran?: number; completed?: number };
};

export type SessionMessageAssistant = {
  id: string;
  type: 'assistant';
  agent: string;
  model: { id: string; providerID: string; variant: string };
  content: Array<AssistantText | AssistantReasoning | AssistantTool>;
  finish?: string;
  time: { created: number; completed?: number };
  error?: { message: string };
};

export type SessionMessage = SessionMessageUser | SessionMessageAssistant;
