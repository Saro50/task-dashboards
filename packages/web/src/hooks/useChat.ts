import { useState, useCallback, useRef, useEffect } from 'react';
import { chatApi } from '@/api/chat';
import { stepApi } from '@/api/step';
import { log } from '@/utils/log';
import { chatDebug } from '@/utils/chatDebug';
import type { ChatSession, ChatMessage, SSEEventPayload, ImageAttachment, FilePartInput } from '@/types/chat';

const S = 'useChat';
const LOADING_TIMEOUT_MS = 60_000;
const SSE_RECONNECT_DELAY_MS = 3_000;
const MAX_IMAGE_SIZE = 1 * 1024 * 1024; // 1MB
const ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

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
  const [importedPlanTasks, setImportedPlanTasks] = useState<Set<string>>(new Set());
  const [lastSent, setLastSent] = useState<LastSentSnapshot | null>(null);
  const [compacted, setCompacted] = useState(false);

  // ─── 图片附件状态 ─────────────────────────────────
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const attachmentIdCounter = useRef(0);

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

  // ─── 附件操作方法 ─────────────────────────────────

  /**
   * 将文件列表添加为图片附件。
   * 校验大小（< 1MB）和格式（png/jpg/gif/webp），不合规的跳过。
   *
   * 上游（ChatInput 文件选择 / paste 事件）调用；
   * 下游（sendMessage）从 attachments 读取并上传。
   */
  const addAttachments = useCallback((files: File[]) => {
    const newAttachments: ImageAttachment[] = [];

    for (const file of files) {
      if (!ALLOWED_IMAGE_MIME.includes(file.type)) {
        log.warn(S, 'addAttachments: unsupported type', { name: file.name, type: file.type });
        continue;
      }
      if (file.size > MAX_IMAGE_SIZE) {
        log.warn(S, 'addAttachments: file too large', { name: file.name, size: file.size });
        continue;
      }
      const id = `att-${++attachmentIdCounter.current}`;
      newAttachments.push({
        id,
        file,
        previewUrl: URL.createObjectURL(file),
        status: 'pending',
        mime: file.type,
        filename: file.name,
        size: file.size,
      });
    }

    if (newAttachments.length > 0) {
      setAttachments((prev) => [...prev, ...newAttachments]);
    }
  }, []);

  /**
   * 删除指定附件，并释放其 previewUrl。
   * 上游（ChatInput 附件 ✕ 按钮）调用。
   */
  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const att = prev.find((a) => a.id === id);
      if (att) URL.revokeObjectURL(att.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  /**
   * 清理所有附件（释放 previewUrl）。
   * 发送成功后调用：延迟释放 blob URL，留出时间让乐观消息继续用 blob URL 渲染，
   * 等服务端消息加载替换乐观消息后 blob 才真正失效。
   */
  const clearAttachments = useCallback(() => {
    setAttachments((prev) => {
      // 延迟 5s 释放 blob URL，确保乐观 UI 在 loadMessages 替换前不会裂图
      const urls = prev.map((att) => att.previewUrl);
      if (urls.length > 0) {
        setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 5000);
      }
      return [];
    });
  }, []);

  /** 是否有附件正在上传中 */
  const hasUploadingAttachments = attachments.some((a) => a.status === 'uploading');

  /**
   * 上传给定的附件列表，返回上传成功的 FilePartInput 数组。
   * 状态流转：pending → uploading → done / error
   *
   * 调用方（sendMessage）通过闭包快照直接传入待上传附件，
   * 避免通过 setAttachments 函数式更新重新读取 state 导致的闭包/批处理不一致问题。
   *
   * 上传失败的附件标记为 error，不阻塞其他附件和文本发送。
   */
  const uploadPendingAttachments = useCallback(async (items: ImageAttachment[]): Promise<FilePartInput[]> => {
    log.info(S, 'uploadPendingAttachments', { pendingCount: items.length, pendingIds: items.map(a => a.id) });
    if (items.length === 0) return [];

    const results: FilePartInput[] = [];

    for (const att of items) {
      // 标记为上传中
      setAttachments((prev) =>
        prev.map((a) => (a.id === att.id ? { ...a, status: 'uploading' as const } : a)),
      );

      try {
        log.info(S, 'uploadPendingAttachments: uploading', { id: att.id, filename: att.filename, size: att.size, directory: directoryRef.current });
        const resp = await chatApi.uploadImage(att.file, directoryRef.current);
        log.info(S, 'uploadPendingAttachments: upload success', { id: att.id, remotePath: resp.path, size: resp.size });
        // 标记为上传成功
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === att.id
              ? { ...a, status: 'done' as const, remotePath: resp.path }
              : a,
          ),
        );
        results.push({
          type: 'file',
          mime: att.mime,
          url: resp.path,
          filename: att.filename,
        });
      } catch (err: any) {
        log.error(S, 'uploadPendingAttachments failed', { id: att.id, filename: att.filename, error: err.message, status: err.status });
        // 标记为上传失败，不抛出异常，允许其他附件和文本继续发送
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === att.id
              ? { ...a, status: 'error' as const, error: err.message || '上传失败' }
              : a,
          ),
        );
      }
    }

    log.info(S, 'uploadPendingAttachments: done', { resultsCount: results.length, results: results.map(r => r.url) });
    return results;
  }, []);

  /** 组件卸载时释放所有 previewUrl */
  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      attachments.forEach((att) => URL.revokeObjectURL(att.previewUrl));
    };
  }, []);

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
        stepApi.getImportedPlans(sessionId).catch((err) => {
          log.warn(S, 'getImportedPlans failed', err);
          return [] as Array<{ planHash: string; taskName: string }>;
        }),
      ]);
      log.info(S, 'loadMessages result', { count: msgs?.length, importedCount: imported.length , imported});
      setMessages(msgs);
      setImportedPlanTasks(new Set(imported.map((p) => p.taskName)));

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

  /**
   * 发送消息（含附件上传）。
   *
   * 流程：
   * 1. 构建乐观 UI：在本地消息列表中同时显示文本 + 图片预览
   * 2. 上传所有 pending 附件（已有 done 的直接复用）
   * 3. 上传完成后构造 parts 数组调用后端 API
   * 4. 发送成功后自动清理附件
   *
   * @param text       消息文本（可为空字符串，纯图片发送）
   * @param context    可选 pageContext（由 AIChatWidget 注入）
   * @param _unused    已弃用的 attachments 参数（保留签名兼容）
   */
   const sendMessage = useCallback(async (text: string, context?: string, _unused?: FilePartInput[]) => {
     const sid = currentSessionIdRef.current;
     log.info(S, 'sendMessage', { text: text.slice(0, 80), currentSessionId: sid, directory, hasContext: !!context, attachmentCount: attachments.length, attachmentStatuses: attachments.map(a => ({ id: a.id, status: a.status })) });
     if (!sid) {
       log.warn(S, 'sendMessage skipped: no currentSessionId');
       return;
     }

     // ── 1. 构建乐观 UI ──────────────────────────────
     lastSentTextRef.current = text;
     setLastSent({ text, agent: selectedAgent, context, timestamp: Date.now() });

      chatDebug.request({ text, agent: selectedAgent, context, directory, sessionId: sid });

      // 在临时消息的 parts 中包含文本 + 图片预览信息
      const optimisticParts: Array<{ id: string; type: string; text?: string; [key: string]: unknown }> = [];
      if (text.trim()) {
        optimisticParts.push({ id: `temp-part-${Date.now()}`, type: 'text', text });
      }
      // 为每张附件添加一个 file 类型的 part，用 previewUrl 作为临时 URL
      for (const att of attachments) {
        optimisticParts.push({
          id: `temp-part-file-${Date.now()}-${att.id}`,
          type: 'file',
          mime: att.mime,
          url: att.previewUrl,    // 乐观预览：使用本地 blob URL
          filename: att.filename,
          _optimistic: true,      // 标记为乐观预览（后续消息刷新时会被服务端数据替换）
        });
      }

      setMessages((prev) => [
        ...prev,
        {
          info: { id: `temp-${Date.now()}`, sessionID: sid, role: 'user', time: { created: Date.now() / 1000 } },
          parts: optimisticParts,
        },
      ]);
      setStreamingText('');
      setLoadingTimedOut(false);
      setIsLoading(true);
      startLoadingTimer();

      try {
        // ── 2. 上传所有 pending 附件 ──────────────────
        // 直接使用闭包快照中的附件列表，避免 setAttachments 函数式更新读取 state
        // 导致的闭包/批处理不一致问题
        const pendingItems = attachments.filter((a) => a.status === 'pending');
        log.info(S, 'sendMessage: uploading attachments', { count: pendingItems.length, pendingIds: pendingItems.map(a => a.id) });
        const uploadResults = await uploadPendingAttachments(pendingItems);
        log.info(S, 'sendMessage: upload complete', { uploadResultsCount: uploadResults.length, uploadResults: uploadResults.map(r => r.url) });

        // 如果有附件但全部上传失败且无文本，中止发送
        if (attachments.length > 0 && uploadResults.length === 0 && !text.trim()) {
          log.warn(S, 'all uploads failed and no text, aborting send');
          // 清除乐观消息，避免用户看到已发送但实际未发送的假象
          setMessages((prev) => prev.slice(0, -1));
          setIsLoading(false);
          clearLoadingTimer();
          return;
        }

        // ── 3. 构建发送文本 ──────────────────────────
        // 当前模型不支持原生图片输入，但可通过 MCP 工具读取文件。
        // 因此将图片路径以文本形式拼入消息，让 AI 通过 MCP 工具查看图片。
        let messageText = text;
        if (uploadResults.length > 0) {
          const imageRefs = uploadResults
            .map((f) => `- ${f.filename || '图片'}: ${f.url}`)
            .join('\n');
          messageText = messageText
            ? `${messageText}\n\n[附图]\n${imageRefs}`
            : `[附图]\n${imageRefs}`;
          log.info(S, 'sendMessage: appended image refs to text', { imageRefs });
        }

        // ── 4. 发送消息 ──────────────────────────────
        // 只发送 text part，不发送 file part（引擎通过 MCP 读取图片文件）
        await chatApi.sendMessage(
          sid,
          messageText,
          directory,
          selectedAgent,
          context,
        );
        log.info(S, 'sendMessage API call completed');

        // ── 5. 发送成功后清理附件 ─────────────────────
        clearAttachments();
      } catch (err) {
        log.error(S, 'sendMessage error', err);
        setIsLoading(false);
        clearLoadingTimer();
      }
    }, [directory, selectedAgent, startLoadingTimer, clearLoadingTimer, attachments, uploadPendingAttachments, clearAttachments]);

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

  const addImportedPlanTask = useCallback((taskName: string) => {
    setImportedPlanTasks((prev) => new Set(prev).add(taskName));
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
    importedPlanTasks,
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
    addImportedPlanTask,
    // ─── 图片附件管理 ───
    attachments,
    addAttachments,
    removeAttachment,
    clearAttachments,
    hasUploadingAttachments,
  };
}
