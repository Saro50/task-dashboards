import { log } from '@/utils/log';
import { apiRequest } from '@/api/lib';
import type { ChatSession, ChatMessage, SSEEventPayload } from '@/types/chat';

const S = 'chatApi';
const BASE = '/api/chat';

export const chatApi = {
  listSessions(directory?: string): Promise<ChatSession[]> {
    const query = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    return apiRequest<ChatSession[]>(S, `${BASE}/sessions${query}`);
  },

  createSession(directory?: string, title?: string): Promise<ChatSession> {
    return apiRequest<ChatSession>(S, `${BASE}/sessions`, {
      method: 'POST',
      body: JSON.stringify({ directory, title }),
    });
  },

  getMessages(sessionId: string, directory?: string): Promise<ChatMessage[]> {
    const query = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    return apiRequest<ChatMessage[]>(S, `${BASE}/sessions/${sessionId}/messages${query}`);
  },

  sendMessage(sessionId: string, text: string, directory?: string, agent?: string): Promise<void> {
    const query = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    return apiRequest<void>(S, `${BASE}/sessions/${sessionId}/send${query}`, {
      method: 'POST',
      body: JSON.stringify({ text, agent }),
    });
  },

  abortSession(sessionId: string, directory?: string): Promise<void> {
    const query = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    return apiRequest<void>(S, `${BASE}/sessions/${sessionId}/abort${query}`, {
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
