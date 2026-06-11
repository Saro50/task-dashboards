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

  // ─── @mention 文件搜索状态 ─────────────────────────────────
  const [atQuery, setAtQuery] = useState('');
  const [atResults, setAtResults] = useState<string[]>([]);
  const [atActive, setAtActive] = useState(false);
  const [atSelectedIndex, setAtSelectedIndex] = useState(0);
  const [atTriggerPos, setAtTriggerPos] = useState(-1);
  /** 搜索请求是否进行中（防抖等待 + 网络请求中均为 true） */
  const [atLoading, setAtLoading] = useState(false);
  /** 防抖 timer 引用，用于清理 */
  const atTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // ─── @mention 文件引用逻辑 ─────────────────────────────────

  /**
   * 解析 textarea 中光标位置前是否存在未闭合的 @mention 标记。
   * 匹配规则：光标前的文本末尾存在「行首或空白 + @ + 零或多个非空白字符」。
   * 返回 { query, startPos } 或 null。
   */
  const findAtMention = useCallback((text: string, cursorPos: number): { query: string; startPos: number } | null => {
    const beforeCursor = text.slice(0, cursorPos);
    const match = beforeCursor.match(/(?:^|\s)@(\S*)$/);
    if (!match) return null;
    // match.index 是整个匹配（含前导空白或行首）的起始位置
    const startPos = (match.index ?? 0) + (match[0].length - match[1].length - 1); // 指向 @ 符号
    return { query: match[1], startPos };
  }, []);

  /**
   * 插入 @mention 选中的文件路径。
   * 将 input 中从 atTriggerPos 到光标位置的文本替换为 '@filePath '。
   */
  const insertAtMention = useCallback((filePath: string) => {
    const textarea = inputRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const before = input.slice(0, atTriggerPos);
    const after = input.slice(cursorPos);
    const newValue = before + '@' + filePath + ' ' + after;

    setInput(newValue);
    setAtActive(false);
    setAtResults([]);
    setAtSelectedIndex(0);

    // 聚焦并设置光标位置到插入文本之后
    requestAnimationFrame(() => {
      const newCursorPos = before.length + filePath.length + 2; // '@' + filePath + ' '
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(newCursorPos, newCursorPos);
    });
  }, [input, atTriggerPos]);

  /**
   * @mention 输入变更处理：检测 @ 标记并触发防抖搜索。
   * 此函数包装了 setInput，在每次输入变化时调用。
   */
  const handleInputChange = useCallback((value: string, cursorPos?: number) => {
    setInput(value);

    // 如果没有传入 cursorPos，尝试从 textarea 获取
    const pos = cursorPos ?? inputRef.current?.selectionStart ?? value.length;

    const mention = findAtMention(value, pos);
    if (mention) {
      setAtQuery(mention.query);
      setAtTriggerPos(mention.startPos);
      setAtActive(true);
      setAtSelectedIndex(0);
    } else {
      // 不存在 @mention 标记，关闭下拉菜单
      if (atActive) {
        setAtActive(false);
        setAtResults([]);
      }
    }
  }, [findAtMention, atActive]);

  /**
   * 防抖搜索：当 atActive 为 true 且 directory 存在时，
   * 延迟 200ms 调用后端 search-files API。
   *
   * atLoading 在防抖等待和请求期间均为 true，
   * 当 atActive 变为 false 或组件卸载时自动清理 timer 并重置 loading。
   */
  useEffect(() => {
    // 清除上一次 timer
    if (atTimerRef.current) {
      clearTimeout(atTimerRef.current);
      atTimerRef.current = null;
    }

    if (!atActive || !directory) {
      setAtResults([]);
      setAtLoading(false);
      return;
    }

    // 防抖等待中即标记 loading
    setAtLoading(true);

    atTimerRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ directory });
        if (atQuery) params.set('query', atQuery);
        const res = await fetch(`/api/projects/search-files?${params}`);
        if (!res.ok) {
          log.warn(S, 'searchFiles API error', { status: res.status });
          setAtResults([]);
          return;
        }
        const raw = await res.json();
        const files: string[] = raw?.data?.files ?? [];
        setAtResults(files);
        setAtSelectedIndex(0);
      } catch (err) {
        log.warn(S, 'searchFiles fetch error', err);
        setAtResults([]);
      } finally {
        setAtLoading(false);
      }
    }, 200);

    return () => {
      if (atTimerRef.current) {
        clearTimeout(atTimerRef.current);
        atTimerRef.current = null;
      }
      setAtLoading(false);
    };
  }, [atActive, directory, atQuery]);

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
    // 关闭 @mention 下拉菜单
    setAtActive(false);
    setAtResults([]);
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
    // @mention 下拉菜单键盘导航
    if (atActive && atResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAtSelectedIndex((prev) => Math.min(prev + 1, atResults.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAtSelectedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        insertAtMention(atResults[atSelectedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setAtActive(false);
        setAtResults([]);
        return;
      }
    }

    // 非 @mention 状态下保持原有 Enter 提交行为
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }, [atActive, atResults, atSelectedIndex, insertAtMention, handleSubmit]);

  /**
   * 点击外部关闭 @mention 下拉菜单。
   * 当 atActive 为 true 时监听全局 mousedown，
   * 若点击目标不在下拉菜单内则关闭。
   */
  useEffect(() => {
    if (!atActive) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // 如果点击的不是下拉菜单内的元素，则关闭
      if (!target.closest('[data-at-dropdown]')) {
        setAtActive(false);
        setAtResults([]);
      }
    };

    // 延迟添加监听，避免触发 @ 的那次点击立即关闭
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [atActive]);

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
            onInputChange={handleInputChange}
            onSubmit={handleSubmit}
            onKeyDown={handleKeyDown}
            isLoading={isLoading}
            engineDisabled={engineDisabled}
            inputRef={inputRef}
            onAbort={abortGeneration}
            atActive={atActive}
            atResults={atResults}
            atSelectedIndex={atSelectedIndex}
            atLoading={atLoading}
            atQuery={atQuery}
            onAtSelect={insertAtMention}
            onAtHover={setAtSelectedIndex}
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
