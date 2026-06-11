import { useState, useRef, useEffect, useCallback, useImperativeHandle, useMemo, forwardRef, type KeyboardEvent, type FormEvent } from 'react';
import type { EngineStatus } from './Layout';
import { useChat } from '@/hooks/useChat';
import { log } from '@/utils/log';
import { chatDebug } from '@/utils/chatDebug';
import { unwrap } from '@/api/lib';
import type { ChatMode } from '@/types/chat';
import type { Step } from '@/types/step';
import ChatTitleBar from './chat/ChatTitleBar';
import ChatMessageList from './chat/ChatMessageList';
import ChatInput from './chat/ChatInput';

const S = 'AIChatWidget';

interface Props {
  directory?: string;
  engineStatus: EngineStatus;
  projectId?: string;
  taskId?: string;
  pageContext?: string;
  /**
   * 多模式配置列表。
   * 若传入，则组件默认激活第一个 ChatMode，并使用该模式的 context 替代 pageContext。
   * 若不传，则行为与之前完全一致（直接使用 pageContext prop）。
   */
  chatModes?: ChatMode[];
  onPlanImported?: () => void;
  /** 当前任务的已有步骤列表，用于 StepPlanPreview diff 比对与更新 */
  existingSteps?: Step[];
  /**
   * 当前任务名称，用于 StepPlanPreview 判断计划是否属于当前任务。
   * 若提供，非当前任务的计划面板渲染为灰色只读状态（不显示操作按钮）。
   */
  currentTaskName?: string;
}

export interface AIChatWidgetHandle {
  openWithMessage: (msg: string, options?: { newSession?: boolean; agent?: string }) => void;
}

export default forwardRef<AIChatWidgetHandle, Props>(function AIChatWidget({ directory, engineStatus, projectId, taskId, pageContext, chatModes, onPlanImported, existingSteps, currentTaskName }, ref) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [agents, setAgents] = useState<Array<{ name: string; description?: string }>>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** 追踪上次实际注入的 pageContext，用于去重（功能一） */
  const lastSentContextRef = useRef<string | null>(null);

  /**
   * 多模式：当前激活的 ChatMode key。
   * 默认激活 chatModes[0].key；若无 chatModes 则为 null，此时使用 pageContext prop。
   */
  const [activeModeKey, setActiveModeKey] = useState<string | null>(
    () => (chatModes && chatModes.length > 0 ? chatModes[0].key : null),
  );

  /**
   * 计算当前实际使用的 pageContext。
   * 优先使用 activeModeKey 对应的 ChatMode.context；
   * 若无 chatModes 或 key 不匹配，则回退到 pageContext prop。
   */
  const effectivePageContext = (() => {
    if (activeModeKey && chatModes) {
      const mode = chatModes.find((m) => m.key === activeModeKey);
      if (mode) return mode.context;
    }
    return pageContext;
  })();

  /** 当前激活的 ChatMode 对象，用于标题栏 badge 显示 */
  const activeMode = useMemo(() => {
    if (!activeModeKey || !chatModes) return null;
    return chatModes.find((m) => m.key === activeModeKey) ?? null;
  }, [activeModeKey, chatModes]);

  const [fabPos, setFabPos] = useState(() => ({ x: window.innerWidth - 72, y: window.innerHeight - 72 }));
  const [chatPos, setChatPos] = useState<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const dragStart = useRef({ mx: 0, my: 0, fx: 0, fy: 0 });

  const {
    sessions,
    currentSessionId,
    currentSession,
    messages,
    streamingText,
    isLoading,
    isConnected,
    loadingTimedOut,
    sessionBroken,
    selectedAgent,
    setSelectedAgent,
    lastSent,
    compacted,
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
    importedPlanTasks,
    addImportedPlanTask,
  } = useChat(directory);

  const handlePlanImported = useCallback((taskName: string) => {
    addImportedPlanTask(taskName);
    onPlanImported?.();
  }, [addImportedPlanTask, onPlanImported]);

  useImperativeHandle(ref, () => ({
    async openWithMessage(msg: string, options?: { newSession?: boolean; agent?: string }) {
      if (engineStatus === 'disconnected') return;
      setOpen(true);
      if (options?.agent) {
        setSelectedAgent(options.agent);
      }
      if (options?.newSession) {
        await createSession('新会话');
      }
      setInput(msg);
      setTimeout(() => inputRef.current?.focus(), 100);
    },
  }), [engineStatus, createSession, setSelectedAgent]);

  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/engine/agents');
      if (res.ok) {
        const raw = await res.json();
        const { data, requestId } = unwrap<any[]>(raw, res.headers.get('X-Request-Id') || undefined);
        const list = Array.isArray(data) ? data : [];
        log.info(S, 'loadAgents', { requestId, count: list.length });
        setAgents(list.filter((a: any) => a.mode === 'primary' && !a.hidden && !a.native));
      }
    } catch {}
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingText, scrollToBottom]);

  useEffect(() => {
    log.info(S, 'open changed', { open, engineStatus, directory });
    if (open) {
      resetLoading();
      loadSessions();
      loadAgents();
      connectSSE();
      /** chatDebug.session — 面板打开时输出会话状态概要 */
      chatDebug.session({
        sessionId: currentSessionId,
        sessionTitle: currentSession?.title,
        agent: selectedAgent,
        directory,
        connected: isConnected,
        loading: isLoading,
        compacted,
        messageCount: messages.length,
      });
    }
  }, [open]);

  const handleToggle = useCallback(() => {
    if (engineStatus === 'disconnected') {
      log.warn(S, 'handleToggle blocked: engine disconnected');
      return;
    }
    log.info(S, 'handleToggle', { currentOpen: open });
    setOpen((prev) => !prev);
  }, [engineStatus]);

  const onFabPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = false;
    dragStart.current = { mx: e.clientX, my: e.clientY, fx: fabPos.x, fy: fabPos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [fabPos.x, fabPos.y]);

  const onFabPointerMove = useCallback((e: React.PointerEvent) => {
    if (e.buttons === 0) return;
    const dx = e.clientX - dragStart.current.mx;
    const dy = e.clientY - dragStart.current.my;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragging.current = true;
    if (!dragging.current) return;
    const nx = Math.min(Math.max(dragStart.current.fx + dx, 0), window.innerWidth - 56);
    const ny = Math.min(Math.max(dragStart.current.fy + dy, 0), window.innerHeight - 56);
    setFabPos({ x: nx, y: ny });
  }, []);

  const onFabPointerUp = useCallback(() => {
    if (!dragging.current) {
      handleToggle();
    }
  }, [handleToggle]);

  const handleNewSession = useCallback(async () => {
    log.info(S, 'handleNewSession');
    await createSession('新会话');
    lastSentContextRef.current = null;
    inputRef.current?.focus();
  }, [createSession]);

  const handleSwitchSession = useCallback(async (sessionId: string) => {
    log.info(S, 'handleSwitchSession', { sessionId });
    await switchSession(sessionId);
    // 切换会话时重置 pageContext 去重追踪，确保新会话首条消息注入上下文
    lastSentContextRef.current = null;
  }, [switchSession]);

  const handleDeleteSession = useCallback(async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    const session = sessions.find((s) => s.id === sessionId);
    const title = session?.title || '该会话';
    if (!confirm(`确定要删除「${title}」吗？此操作不可恢复。`)) return;
    log.info(S, 'handleDeleteSession', { sessionId });
    await deleteSession(sessionId);
  }, [deleteSession, sessions]);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    log.info(S, 'handleSubmit', { text, isLoading, currentSessionId });
    if (!text || isLoading) return;
    if (!currentSessionId) {
      log.info(S, 'no session, creating new one');
      const session = await createSession('新会话');
      log.info(S, 'created session', { id: session.id });
      await switchSession(session.id);
    }
    setInput('');

    // 功能一：pageContext 去重注入
    // 仅在首条消息或 pageContext 内容变化时注入 system，避免每轮重复发送
    const isFirstMessage = messages.length === 0;
    const contextChanged = effectivePageContext !== lastSentContextRef.current;
    const contextToSend = (isFirstMessage || contextChanged) ? effectivePageContext : undefined;
    lastSentContextRef.current = effectivePageContext ?? lastSentContextRef.current;
    if (contextToSend) {
      log.info(S, 'injecting pageContext', { reason: isFirstMessage ? 'first-message' : 'context-changed', length: contextToSend.length });
    } else {
      log.info(S, 'skipping pageContext injection (unchanged)');
    }

    /** chatDebug.systemPrompt — 在 DevTools Console 输出系统提示词详情 */
    chatDebug.systemPrompt({
      pageContext: effectivePageContext,
      activeMode,
      contextToSend,
      reason: isFirstMessage ? 'first-message' : contextChanged ? 'context-changed' : 'unchanged',
    });

    await sendMessage(text, contextToSend);
    log.info(S, 'sendMessage returned');
  }, [input, isLoading, currentSessionId, createSession, switchSession, sendMessage, effectivePageContext, messages.length]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }, [handleSubmit]);

  const engineDisabled = engineStatus !== 'connected';

  const [chatSize, setChatSize] = useState({ w: 660, h: 640 });
  /** 全屏模式：记录进入全屏前的 chatSize 和 chatPos，用于还原 */
  const [isFullscreen, setIsFullscreen] = useState(false);
  const beforeFullscreenRef = useRef<{ size: { w: number; h: number }; pos: { x: number; y: number } } | null>(null);
  const resizingRef = useRef(false);
  const startRef = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const chatDraggingRef = useRef(false);
  const chatDragStartRef = useRef({ mx: 0, my: 0, cx: 0, cy: 0 });

  const onTitleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, select, input')) return;
    e.preventDefault();
    chatDraggingRef.current = false;
    const pos = chatPos ?? { x: Math.max(8, fabPos.x - chatSize.w), y: Math.max(8, window.innerHeight - fabPos.y - chatSize.h) };
    if (!chatPos) setChatPos(pos);
    chatDragStartRef.current = { mx: e.clientX, my: e.clientY, cx: pos.x, cy: pos.y };
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - chatDragStartRef.current.mx;
      const dy = ev.clientY - chatDragStartRef.current.my;
      if (!chatDraggingRef.current && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      chatDraggingRef.current = true;
      const nx = Math.min(Math.max(chatDragStartRef.current.cx + dx, 0), window.innerWidth - chatSize.w);
      const ny = Math.min(Math.max(chatDragStartRef.current.cy + dy, 0), window.innerHeight - chatSize.h);
      setChatPos({ x: nx, y: ny });
    };
    const onUp = () => {
      chatDraggingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [chatPos, fabPos.x, fabPos.y, chatSize.w, chatSize.h]);

  /** 切换全屏：进入全屏时记录当前尺寸/位置，退出时还原 */
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => {
      if (!prev) {
        // 进入全屏：记录当前状态
        const currentPos = chatPos ?? { x: Math.max(8, fabPos.x - chatSize.w), y: Math.max(8, window.innerHeight - fabPos.y - chatSize.h) };
        beforeFullscreenRef.current = { size: { ...chatSize }, pos: { ...currentPos } };
        setChatSize({ w: window.innerWidth - 32, h: window.innerHeight - 32 });
        setChatPos({ x: 16, y: 16 });
      } else {
        // 退出全屏：从 ref 恢复（若无记录则用默认值）
        const saved = beforeFullscreenRef.current;
        if (saved) {
          setChatSize(saved.size);
          setChatPos(saved.pos);
        } else {
          setChatSize({ w: 660, h: 640 });
          setChatPos(null);
        }
        beforeFullscreenRef.current = null;
      }
      return !prev;
    });
  }, [chatSize, chatPos, fabPos.x, fabPos.y]);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    startRef.current = { x: e.clientX, y: e.clientY, w: chatSize.w, h: chatSize.h };
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const dw = startRef.current.x - ev.clientX;
      const dh = startRef.current.y - ev.clientY;
      setChatSize({
        w: Math.min(Math.max(startRef.current.w + dw, 360), window.innerWidth - 32),
        h: Math.min(Math.max(startRef.current.h + dh, 400), window.innerHeight - 32),
      });
    };
    const onUp = () => {
      resizingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [chatSize]);

  return (
    <>
      {!open && (
        <button
          onPointerDown={onFabPointerDown}
          onPointerMove={onFabPointerMove}
          onPointerUp={onFabPointerUp}
          title={engineDisabled ? '请先配置引擎' : '打开 AI 助手'}
          className="fixed z-[100] w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-colors duration-200 cursor-pointer touch-none select-none"
          style={{
            left: fabPos.x,
            top: fabPos.y,
          }}
        >
          <div className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg ${
            engineDisabled
              ? 'bg-gray-400 cursor-not-allowed opacity-60'
              : 'bg-sky-500 hover:bg-sky-600 shadow-sky-500/25'
          }`}>
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
          </div>
        </button>
      )}

      {open && (
        <div
          className="fixed z-[100] bg-white border border-gray-200 rounded-xl shadow-2xl flex flex-col animate-[scaleIn_0.2s_ease_both]"
          style={{
            width: chatSize.w,
            height: chatSize.h,
            maxWidth: 'calc(100vw - 2rem)',
            maxHeight: 'calc(100vh - 2rem)',
            left: isFullscreen ? 16 : (chatPos?.x ?? Math.max(8, fabPos.x - chatSize.w)),
            top: isFullscreen ? 16 : (chatPos?.y ?? Math.max(8, window.innerHeight - fabPos.y - chatSize.h)),
          }}
        >
          <ChatTitleBar
            directory={directory}
            activeMode={activeMode}
            activeModeKey={activeModeKey}
            chatModes={chatModes}
            agents={agents}
            selectedAgent={selectedAgent}
            onSelectAgent={setSelectedAgent}
            onSelectMode={setActiveModeKey}
            sessions={sessions}
            currentSessionId={currentSessionId}
            currentSession={currentSession}
            isFullscreen={isFullscreen}
            onToggleFullscreen={toggleFullscreen}
            onNewSession={handleNewSession}
            onSwitchSession={handleSwitchSession}
            onDeleteSession={handleDeleteSession}
            onRenameSession={renameSession}
            onClose={() => { log.info(S, 'close chat panel'); setOpen(false); }}
            onTitleMouseDown={onTitleMouseDown}
          />

          <ChatMessageList
            messages={messages}
            streamingText={streamingText}
            isLoading={isLoading}
            loadingTimedOut={loadingTimedOut}
            sessionBroken={sessionBroken}
            compacted={compacted}
            projectId={projectId}
            taskId={taskId}
            currentSessionId={currentSessionId ?? undefined}
            importedPlanTasks={importedPlanTasks}
            onPlanImported={handlePlanImported}
            existingSteps={existingSteps}
            currentTaskName={currentTaskName}
            effectivePageContext={effectivePageContext}
            onRetryInNewSession={retryInNewSession}
            onDismissSessionBroken={dismissSessionBroken}
            onResetLoading={resetLoading}
            messagesEndRef={messagesEndRef}
          />

          <ChatInput
            input={input}
            onInputChange={setInput}
            onSubmit={handleSubmit}
            onKeyDown={handleKeyDown}
            isLoading={isLoading}
            engineDisabled={engineDisabled}
            inputRef={inputRef}
            onAbort={abortGeneration}
          />

          <div
            onMouseDown={startResize}
            className="absolute top-0 left-0 w-4 h-full cursor-col-resize z-10 flex items-center justify-center"
          >
            <div className="w-1 h-8 rounded-full bg-gray-300 hover:bg-gray-400 transition-colors" />
          </div>
          <div
            onMouseDown={startResize}
            className="absolute top-0 left-0 right-0 h-4 cursor-row-resize z-10 flex items-center justify-center"
          >
            <div className="h-1 w-8 rounded-full bg-gray-300 hover:bg-gray-400 transition-colors" />
          </div>
          <div
            onMouseDown={startResize}
            className="absolute top-0 left-0 w-4 h-4 cursor-nw-resize z-20"
          />
        </div>
      )}
    </>
  );
});
