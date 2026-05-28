import { useState, useCallback, useRef, useEffect } from 'react';
import { chatApi } from '@/api/chat';
import { log } from '@/utils/log';
import type { ChatSession, ChatMessage, SSEEventPayload } from '@/types/chat';

const S = 'useChat';

export function useChat(directory?: string) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const directoryRef = useRef(directory);
  directoryRef.current = directory;
  const currentSessionIdRef = useRef(currentSessionId);
  currentSessionIdRef.current = currentSessionId;

  const currentSession = sessions.find((s) => s.id === currentSessionId) || null;

  const loadMessages = useCallback(async (sessionId: string) => {
    try {
      log.info(S, 'loadMessages', { sessionId, directory: directoryRef.current });
      const msgs = await chatApi.getMessages(sessionId, directoryRef.current);
      log.info(S, 'loadMessages result', { count: msgs?.length });
      setMessages(msgs);
    } catch (err) {
      log.error(S, 'loadMessages error', err);
      setMessages([]);
    }
  }, []);

  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      log.info(S, 'connectSSE closing previous EventSource');
      eventSourceRef.current.close();
    }

    log.info(S, 'connectSSE starting', { directory: directoryRef.current });
    let deltaCount = 0;

    let assistantMsgId: string | null = null;

    const es = chatApi.subscribeEvents(
      (payload: SSEEventPayload) => {
        setIsConnected(true);

        if (payload.type === 'message.updated') {
          const info = payload.properties?.info;
          if (info?.role === 'assistant' && !info?.finish) {
            assistantMsgId = info.id;
            log.info(S, 'SSE assistant message started', { id: info.id });
          }
          if (info?.role === 'assistant' && info?.finish) {
            log.info(S, 'SSE assistant finished', { finish: info.finish, deltasReceived: deltaCount });
            setIsLoading(false);
            setStreamingText('');
            assistantMsgId = null;
            const sid = currentSessionIdRef.current;
            if (sid) {
              loadMessages(sid);
            }
          }
        }

        if (payload.type === 'message.part.delta') {
          if (assistantMsgId && payload.properties?.messageID === assistantMsgId) {
            deltaCount++;
            const delta = payload.properties?.delta;
            if (typeof delta === 'string' && delta) {
              setStreamingText((prev) => prev + delta);
            }
            if (deltaCount === 1) {
              log.info(S, 'SSE first delta', { delta: delta?.slice(0, 30) });
            }
          }
        }

        if (payload.type === 'message.part.updated') {
          if (assistantMsgId && payload.properties?.part?.messageID === assistantMsgId) {
            const part = payload.properties?.part;
            if (part?.type === 'text' && part?.text) {
              setStreamingText(part.text);
            }
          }
        }

        if (payload.type === 'session.status') {
          const status = payload.properties?.status;
          if (status?.type === 'idle') {
            setIsLoading(false);
          } else if (status?.type === 'busy') {
            setIsLoading(true);
          }
        }

        if (payload.type === 'session.idle') {
          log.info(S, 'SSE session.idle', { deltasReceived: deltaCount });
          setIsLoading(false);
          setStreamingText('');
          assistantMsgId = null;
          const sid = currentSessionIdRef.current;
          if (sid) {
            loadMessages(sid);
          }
        }

        if (payload.type === 'session.created') {
          const info = payload.properties?.info as { id: string; title: string; directory: string; time: { created: number; updated: number } } | undefined;
          if (info) {
            setSessions((prev) => {
              if (prev.some((s) => s.id === info.id)) return prev;
              return [{ id: info.id, title: info.title || '新会话', directory: info.directory || '', time: info.time }, ...prev];
            });
          }
        }
      },
      () => {
        log.warn(S, 'SSE error / disconnected');
        setIsConnected(false);
      },
      directoryRef.current,
    );

    eventSourceRef.current = es;
    setIsConnected(true);
  }, [loadMessages]);

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      log.info(S, 'loadSessions', { directory });
      const list = await chatApi.listSessions(directory);
      log.info(S, 'loadSessions result', { count: list?.length });
      setSessions(list);
      if (list.length > 0 && !currentSessionIdRef.current) {
        const latest = list.reduce((a, b) => (a.time.updated > b.time.updated ? a : b));
        log.info(S, 'auto-select latest session', { id: latest.id });
        setCurrentSessionId(latest.id);
        await loadMessages(latest.id);
      }
    } catch (err) {
      log.error(S, 'loadSessions error', err);
      setSessions([]);
    }
  }, [directory, loadMessages]);

  const createSession = useCallback(async (title?: string) => {
    log.info(S, 'createSession', { directory, title });
    const session = await chatApi.createSession(directory, title);
    log.info(S, 'createSession result', { id: session?.id, title: session?.title });
    setSessions((prev) => [session, ...prev]);
    setCurrentSessionId(session.id);
    setMessages([]);
    setStreamingText('');
    setIsLoading(false);
    return session;
  }, [directory]);

  const switchSession = useCallback(async (sessionId: string) => {
    log.info(S, 'switchSession', { sessionId });
    setCurrentSessionId(sessionId);
    setStreamingText('');
    setIsLoading(false);
    await loadMessages(sessionId);
  }, [loadMessages]);

  const sendMessage = useCallback(async (text: string) => {
    log.info(S, 'sendMessage', { text: text.slice(0, 80), currentSessionId, directory });
    if (!currentSessionId) {
      log.warn(S, 'sendMessage skipped: no currentSessionId');
      return;
    }

    setStreamingText('');
    setIsLoading(true);

    try {
      await chatApi.sendMessage(currentSessionId, text, directory);
      log.info(S, 'sendMessage API call completed');
    } catch (err) {
      log.error(S, 'sendMessage error', err);
      setIsLoading(false);
    }
  }, [currentSessionId, directory]);

  const abortGeneration = useCallback(async () => {
    if (!currentSessionId) return;
    log.info(S, 'abortGeneration', { currentSessionId });
    try {
      await chatApi.abortSession(currentSessionId, directory);
      setIsLoading(false);
      setStreamingText('');
      await loadMessages(currentSessionId);
    } catch (err) {
      log.error(S, 'abortGeneration error', err);
    }
  }, [currentSessionId, directory, loadMessages]);

  const deleteSession = useCallback(async (sessionId: string) => {
    log.info(S, 'deleteSession', { sessionId, currentSessionId });
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    if (currentSessionId === sessionId) {
      const remaining = sessions.filter((s) => s.id !== sessionId);
      if (remaining.length > 0) {
        await switchSession(remaining[0].id);
      } else {
        setCurrentSessionId(null);
        setMessages([]);
      }
    }
  }, [currentSessionId, sessions, switchSession]);

  return {
    sessions,
    currentSessionId,
    currentSession,
    messages,
    streamingText,
    isLoading,
    isConnected,
    loadSessions,
    createSession,
    switchSession,
    sendMessage,
    abortGeneration,
    deleteSession,
    connectSSE,
  };
}
