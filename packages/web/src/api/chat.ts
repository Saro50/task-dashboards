import { log } from '@/utils/log';
import type { ChatSession, ChatMessage, SSEEventPayload } from '@/types/chat';

const S = 'chatApi';
const BASE = '/api/chat';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const method = options?.method || 'GET';
  log.info(S, `${method} ${url}`);
  if (options?.body) {
    log.info(S, 'request body', { body: (options.body as string).slice(0, 200) });
  }
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  log.info(S, `response ${res.status} ${method} ${url}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    log.error(S, `request failed ${res.status} ${url}`, body);
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  if (res.status === 204) {
    log.info(S, `${method} ${url} completed (204 no content)`);
    return undefined as T;
  }
  return res.json();
}

export const chatApi = {
  listSessions(directory?: string): Promise<ChatSession[]> {
    const query = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    return request<ChatSession[]>(`${BASE}/sessions${query}`);
  },

  createSession(directory?: string, title?: string): Promise<ChatSession> {
    return request<ChatSession>(`${BASE}/sessions`, {
      method: 'POST',
      body: JSON.stringify({ directory, title }),
    });
  },

  getMessages(sessionId: string, directory?: string): Promise<ChatMessage[]> {
    const query = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    return request<ChatMessage[]>(`${BASE}/sessions/${sessionId}/messages${query}`);
  },

  sendMessage(sessionId: string, text: string, directory?: string, agent?: string): Promise<void> {
    const query = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    return request<void>(`${BASE}/sessions/${sessionId}/send${query}`, {
      method: 'POST',
      body: JSON.stringify({ text, agent }),
    });
  },

  abortSession(sessionId: string, directory?: string): Promise<void> {
    const query = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    return request<void>(`${BASE}/sessions/${sessionId}/abort${query}`, {
      method: 'POST',
    });
  },

  subscribeEvents(
    onEvent: (payload: SSEEventPayload) => void,
    onError?: (err: unknown) => void,
    directory?: string,
  ): EventSource {
    const query = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    const url = `${BASE}/events${query}`;
    log.info(S, `SSE connecting to ${url}`);
    const es = new EventSource(url);

    es.onopen = () => {
      log.info(S, 'SSE connection opened');
    };

    es.addEventListener('message.part.updated', (e) => {
      try {
        onEvent({ type: 'message.part.updated', properties: JSON.parse(e.data) });
      } catch (err) {
        log.error(S, 'SSE parse error message.part.updated', err);
      }
    });

    es.addEventListener('message.part.delta', (e) => {
      try {
        onEvent({ type: 'message.part.delta', properties: JSON.parse(e.data) });
      } catch (err) {
        log.error(S, 'SSE parse error message.part.delta', err);
      }
    });

    es.addEventListener('message.updated', (e) => {
      try {
        onEvent({ type: 'message.updated', properties: JSON.parse(e.data) });
      } catch (err) {
        log.error(S, 'SSE parse error message.updated', err);
      }
    });

    es.addEventListener('session.status', (e) => {
      try {
        onEvent({ type: 'session.status', properties: JSON.parse(e.data) });
      } catch (err) {
        log.error(S, 'SSE parse error session.status', err);
      }
    });

    es.addEventListener('session.created', (e) => {
      try {
        onEvent({ type: 'session.created', properties: JSON.parse(e.data) });
      } catch (err) {
        log.error(S, 'SSE parse error session.created', err);
      }
    });

    es.addEventListener('session.updated', (e) => {
      try {
        onEvent({ type: 'session.updated', properties: JSON.parse(e.data) });
      } catch (err) {
        log.error(S, 'SSE parse error session.updated', err);
      }
    });

    es.addEventListener('session.idle', (e) => {
      try {
        onEvent({ type: 'session.idle', properties: JSON.parse(e.data) });
      } catch (err) {
        log.error(S, 'SSE parse error session.idle', err);
      }
    });

    es.onerror = (err) => {
      log.error(S, `SSE error readyState=${es.readyState}`, err);
      if (onError) onError(err);
    };

    return es;
  },
};
