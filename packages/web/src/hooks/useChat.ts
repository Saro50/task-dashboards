import { useState, useCallback, useRef, useEffect } from 'react';
import { chatApi } from '@/api/chat';
import { taskApi } from '@/api/task';
import { log } from '@/utils/log';
import { chatDebug } from '@/utils/chatDebug';
import type { ChatSession, ChatMessage, SSEEventPayload } from '@/types/chat';

const S = 'useChat';
const LOADING_TIMEOUT_MS = 60_000;
const SSE_RECONNECT_DELAY_MS = 3_000;

/**
 * 最近一次 sendMessage 的完整快照，供调试面板展示
 * 实际传入后端的 { text, agent, context } 原文。
 */
export interface LastSentSnapshot {
  text: string;
  agent: string;
  context?: string;
  timestamp: number;
}

export function useChat(directory?: string) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string>('task-helper');
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const directoryRef = useRef(directory);
  directoryRef.current = directory;
  const currentSessionIdRef = useRef(currentSessionId);
  currentSessionIdRef.current = currentSessionId;
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sseReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const lastSentTextRef = useRef<string | null>(null);
  const [sessionBroken, setSessionBroken] = useState(false);
  const [importedPlanTopics, setImportedPlanTopics] = useState<Set<string>>(new Set());
  const [lastSent, setLastSent] = useState<LastSentSnapshot | null>(null);
  const [compacted, setCompacted] = useState(false);

  const currentSession = sessions.find((s) => s.id === currentSessionId) || null;

  const clearLoadingTimer = useCallback(() => {
    if (loadingTimerRef.current) {
      clearTimeout(loadingTimerRef.current);
      loadingTimerRef.current = null;
    }
  }, []);

  const startLoadingTimer = useCallback(() => {
    clearLoadingTimer();
    loadingTimerRef.current = setTimeout(() => {
      if (mountedRef.current) {
        log.warn(S, 'loading timeout, resetting isLoading');
        setIsLoading(false);
        setLoadingTimedOut(true);
      }
    }, LOADING_TIMEOUT_MS);
  }, [clearLoadingTimer]);

  const resetLoading = useCallback(() => {
    setIsLoading(false);
    setStreamingText('');
    setLoadingTimedOut(false);
    clearLoadingTimer();
  }, [clearLoadingTimer]);

  const loadMessages = useCallback(async (sessionId: string) => {
    try {
      log.info(S, 'loadMessages', { sessionId, directory: directoryRef.current });
      const [msgs, imported] = await Promise.all([
        chatApi.getMessages(sessionId, directoryRef.current),
        taskApi.getImportedPlans(sessionId).catch((err) => {
          log.warn(S, 'getImportedPlans failed', err);
          return [] as Array<{ planHash: string; topicName: string }>;
        }),
      ]);
      log.info(S, 'loadMessages result', { count: msgs?.length, importedCount: imported.length , imported});
      setMessages(msgs);
      setImportedPlanTopics(new Set(imported.map((p) => p.topicName)));

      /** chatDebug — 消息加载后输出 Token 统计和历史消息 */
      chatDebug.tokens(msgs);
      chatDebug.history(msgs);
      chatDebug.roundSummary(msgs);
    } catch (err) {
      log.error(S, 'loadMessages error', err);
      setMessages([]);
    }
  }, []);

  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      log.info(S, 'connectSSE closing previous EventSource');
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (sseReconnectTimerRef.current) {
      clearTimeout(sseReconnectTimerRef.current);
      sseReconnectTimerRef.current = null;
    }

    log.info(S, 'connectSSE starting', { directory: directoryRef.current });
    let deltaCount = 0;
    let assistantMsgId: string | null = null;

    const es = chatApi.subscribeEvents(
      (payload: SSEEventPayload) => {
        setIsConnected(true);
        setLoadingTimedOut(false);
        if (payload.type === 'message.updated') {
          const info = payload.properties?.info;
          if (info?.role === 'assistant' && !info?.finish) {
            assistantMsgId = info.id;
            log.info(S, 'SSE assistant message started', { id: info.id });
            chatDebug.sseEvent('message.updated', { role: 'assistant', id: info.id, finish: false });
          }
          if (info?.role === 'assistant' && info?.finish) {
            log.info(S, 'SSE assistant finished', { finish: info.finish, deltasReceived: deltaCount });
            chatDebug.sseEvent('message.updated', { role: 'assistant', finish: info.finish, deltas: deltaCount });
            setIsLoading(false);
            setStreamingText('');
            clearLoadingTimer();
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
              clearLoadingTimer();
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
            clearLoadingTimer();
          } else if (status?.type === 'busy') {
            setIsLoading(true);
          }
        }

        if (payload.type === 'session.idle') {
          log.info(S, 'SSE session.idle', { deltasReceived: deltaCount });
          chatDebug.sseEvent('session.idle', { deltasReceived: deltaCount });
          setIsLoading(false);
          setStreamingText('');
          clearLoadingTimer();
          assistantMsgId = null;
          const sid = currentSessionIdRef.current;
          if (sid) {
            loadMessages(sid);
          }
          if (deltaCount === 0 && lastSentTextRef.current) {
            log.warn(S, 'session.idle with 0 deltas, session may be broken');
            setSessionBroken(true);
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

        if (payload.type === 'session.updated') {
          const info = payload.properties?.info as { id: string; title: string; directory: string; time: { created: number; updated: number } } | undefined;
          if (info?.id) {
            setSessions((prev) =>
              prev.map((s) => s.id === info.id ? { ...s, title: info.title || s.title, time: info.time || s.time } : s)
            );
          }
        }

        if (payload.type === 'session.compacted') {
          log.info(S, 'SSE session.compacted — engine auto-compacted context');
          chatDebug.sseEvent('session.compacted');
          setCompacted(true);
        }
      },
      () => {
        log.warn(S, 'SSE error, scheduling reconnect');
        setIsConnected(false);
        if (mountedRef.current) {
          sseReconnectTimerRef.current = setTimeout(() => {
            if (mountedRef.current) {
              log.info(S, 'SSE reconnecting...');
              connectSSE();
            }
          }, SSE_RECONNECT_DELAY_MS);
        }
      },
      directoryRef.current,
    );

    eventSourceRef.current = es;
    setIsConnected(true);
  }, [loadMessages, clearLoadingTimer]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (sseReconnectTimerRef.current) {
        clearTimeout(sseReconnectTimerRef.current);
      }
      if (loadingTimerRef.current) {
        clearTimeout(loadingTimerRef.current);
      }
    };
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      log.info(S, 'loadSessions', { directory });
      const list = await chatApi.listSessions(directory);
      log.info(S, 'loadSessions result', { sessions: list });
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
    log.info(S, 'createSession result', session);
    setSessions((prev) => {
      if (prev.some((s) => s.id === session.id)) return prev;
      return [session, ...prev];
    });
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

  const sendMessage = useCallback(async (text: string, context?: string) => {
    log.info(S, 'sendMessage', { text: text.slice(0, 80), currentSessionId, directory, hasContext: !!context });
    if (!currentSessionId) {
      log.warn(S, 'sendMessage skipped: no currentSessionId');
      return;
    }

    lastSentTextRef.current = text;
    setLastSent({ text, agent: selectedAgent, context, timestamp: Date.now() });

    /** chatDebug.request — 在 DevTools Console 输出完整请求信息 */
    chatDebug.request({ text, agent: selectedAgent, context, directory, sessionId: currentSessionId });
    setMessages((prev) => [
      ...prev,
      {
        info: { id: `temp-${Date.now()}`, sessionID: currentSessionId, role: 'user', time: { created: Date.now() / 1000 } },
        parts: [{ id: `temp-part-${Date.now()}`, type: 'text', text }],
      },
    ]);
    setStreamingText('');
    setLoadingTimedOut(false);
    setIsLoading(true);
    startLoadingTimer();

    try {
      await chatApi.sendMessage(currentSessionId, text, directory, selectedAgent, context);
      log.info(S, 'sendMessage API call completed');
    } catch (err) {
      log.error(S, 'sendMessage error', err);
      setIsLoading(false);
      clearLoadingTimer();
    }
  }, [currentSessionId, directory, selectedAgent, startLoadingTimer, clearLoadingTimer]);

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
    try {
      await chatApi.deleteSession(sessionId, directory);
      log.info(S, 'deleteSession API call completed', { sessionId });
    } catch (err) {
      log.error(S, 'deleteSession API error', err);
    }
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
  }, [currentSessionId, directory, sessions, switchSession]);

  const retryInNewSession = useCallback(async (context?: string) => {
    const text = lastSentTextRef.current;
    if (!text) return;
    log.info(S, 'retryInNewSession', { text: text.slice(0, 80) });
    setSessionBroken(false);
    const session = await createSession('新会话');
    await switchSession(session.id);
    lastSentTextRef.current = text;
    await sendMessage(text, context);
  }, [createSession, switchSession, sendMessage]);

  const dismissSessionBroken = useCallback(() => {
    setSessionBroken(false);
  }, []);

  const renameSession = useCallback(async (sessionId: string, title: string) => {
    log.info(S, 'renameSession', { sessionId, title });
    try {
      const updated = await chatApi.updateSessionTitle(sessionId, title, directory);
      log.info(S, 'renameSession result', { id: updated?.id, title: updated?.title });
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, title: updated?.title || title } : s)),
      );
    } catch (err) {
      log.error(S, 'renameSession error', err);
    }
  }, [directory]);

  const addImportedPlanTopic = useCallback((topicName: string) => {
    setImportedPlanTopics((prev) => new Set(prev).add(topicName));
  }, []);

  return {
    sessions,
    currentSessionId,
    currentSession,
    messages,
    streamingText,
    isLoading,
    isConnected,
    loadingTimedOut,
    sessionBroken,
    importedPlanTopics,
    lastSent,
    compacted,
    selectedAgent,
    setSelectedAgent,
    loadSessions,
    createSession,
    switchSession,
    sendMessage,
    abortGeneration,
    deleteSession,
    connectSSE,
    resetLoading,
    retryInNewSession,
    dismissSessionBroken,
    renameSession,
    addImportedPlanTopic,
  };
}
