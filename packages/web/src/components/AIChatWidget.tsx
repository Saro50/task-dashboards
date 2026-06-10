import { useState, useRef, useEffect, useCallback, useImperativeHandle, useMemo, forwardRef, type KeyboardEvent, type FormEvent } from 'react';
import type { EngineStatus } from './Layout';
import { useChat } from '@/hooks/useChat';
import { log } from '@/utils/log';
import { chatDebug } from '@/utils/chatDebug';
import { unwrap } from '@/api/lib';
import type { ChatMessage, ChatPart, ChatMode } from '@/types/chat';
import type { StepPlan, Step } from '@/types/step';
import StepPlanPreview from './StepPlanPreview';

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

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-3 h-3 text-gray-400 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
      fill="none" stroke="currentColor" viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
    </svg>
  );
}

function ToolStatusLabel({ status }: { status: string }) {
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-yellow-500">
        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        运行中
      </span>
    );
  }
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-green-500">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.5 12.75l6 6 9-13.5" />
        </svg>
        完成
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-red-500">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
        </svg>
        错误
      </span>
    );
  }
  return (
    <span className="text-[10px] text-gray-400">等待中</span>
  );
}

function Collapsible({ title, icon, defaultOpen = false, children }: {
  title: React.ReactNode;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg bg-gray-50 border border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
      >
        <ChevronIcon open={open} />
        {icon}
        <span className="truncate flex-1 text-left">{title}</span>
      </button>
      {open && <div className="px-2.5 pb-2">{children}</div>}
    </div>
  );
}

function repairJson(str: string): string {
  let result = '';
  let inString = false;
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (!inString) {
      result += ch;
      if (ch === '"') inString = true;
    } else {
      if (ch === '\\') {
        result += ch + (str[i + 1] || '');
        i += 2;
        continue;
      }
      if (ch === '"') {
        const rest = str.slice(i + 1).trimStart();
        if (rest.length === 0 || /^[,}\]):]/.test(rest)) {
          result += ch;
          inString = false;
        } else {
          result += '\\"';
        }
      } else {
        result += ch;
      }
    }
    i++;
  }
  return result;
}

function PartRenderer({ part, projectId, taskId, chatSessionId, importedPlanTasks, onPlanImported, existingSteps, currentTaskName }: {
  part: ChatPart;
  projectId?: string;
  taskId?: string;
  chatSessionId?: string;
  importedPlanTasks: Set<string>;
  onPlanImported: (taskName: string) => void;
  /** 当前任务已有步骤，用于 diff 比对 */
  existingSteps?: Step[];
  /** 当前任务名称，用于判断计划是否属于当前任务 */
  currentTaskName?: string;
}) {
  if (part.type === 'text' && part.text) {
    const text = part.text;
    const taskPlanRegex = /<task-plan>\n?([\s\S]*?)\n?<\/task-plan>/g;
    const segments: Array<{ type: 'text' | 'plan'; content: string | StepPlan }> = [];
    let lastIndex = 0;
    let match;

    while ((match = taskPlanRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
      }
      try {
        let jsonStr = match[1].trim();
        jsonStr = jsonStr.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/,'');
        let plan: StepPlan;
        try {
          plan = JSON.parse(jsonStr);
        } catch {
          plan = JSON.parse(repairJson(jsonStr));
        }
        // 兼容 AI 旧格式输出：AI 可能输出 tasks 字段而非 steps
        if (!plan.steps && (plan as any).tasks) {
          plan.steps = (plan as any).tasks;
        }
        // 兼容 AI 旧格式输出：AI 可能输出 topic 字段而非 task
        if (!plan.task && (plan as any).topic) {
          plan.task = (plan as any).topic;
        }
        segments.push({ type: 'plan', content: plan });
      } catch {
        segments.push({ type: 'text', content: match[0] });
      }
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      segments.push({ type: 'text', content: text.slice(lastIndex) });
    }

    if (segments.length === 0 || (segments.length === 1 && segments[0].type === 'text')) {
      return <p className="whitespace-pre-wrap break-words">{text}</p>;
    }

    return (
      <>
        {segments.map((seg, i) =>
          seg.type === 'text' ? (
            <p key={i} className="whitespace-pre-wrap break-words">{seg.content as string}</p>
          ) : (
            <StepPlanPreview
              key={i}
              plan={seg.content as StepPlan}
              projectId={projectId}
              taskId={taskId}
              chatSessionId={chatSessionId}
              imported={importedPlanTasks.has((seg.content as StepPlan).task)}
              onPlanImported={onPlanImported}
              existingSteps={existingSteps}
              currentTaskName={currentTaskName}
            />
          )
        )}
      </>
    );
  }

  if (part.type === 'reasoning' && part.text) {
    const t = part.text;
    const preview = t.length > 60 ? t.slice(0, 60) + '...' : t;
    return (
      <Collapsible
        title={<span className="italic text-gray-400">思考: {preview}</span>}
        icon={
          <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.414-2.379a5.515 5.515 0 00-1.414-2.379V12c0-1.576.758-3.016 2.024-3.887a4.5 4.5 0 00-1.414-2.379C14.578 4.914 13.81 4.5 13 4.5H11c-.81 0-1.578.414-2.024 1.086A4.5 4.5 0 007.562 8.1 4.5 4.5 0 006 12v.354c0 .983-.658 1.823-1.414 2.379A5.515 5.515 0 006 16.879V18" />
          </svg>
        }
      >
        <p className="text-xs text-gray-400 italic whitespace-pre-wrap break-words border-l-2 border-gray-200 pl-2 leading-relaxed">
          {part.text}
        </p>
      </Collapsible>
    );
  }

  if (part.type === 'tool') {
    const toolName = part.tool || 'tool';
    const state = part.state;
    const title = state?.title || toolName;
    const preview = state?.output
      ? (state.output.length > 80 ? state.output.slice(0, 80) + '...' : state.output)
      : null;

    return (
      <Collapsible
        title={
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-gray-700">{title}</span>
            <ToolStatusLabel status={state?.status || 'pending'} />
            {preview && <span className="text-gray-400 truncate hidden sm:inline">{preview}</span>}
          </span>
        }
        icon={
          <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.42 15.17l-5.1-3.26a1.5 1.5 0 010-2.56l5.1-3.26a1.5 1.5 0 012.16.96l.78 4.42a1.5 1.5 0 01-2.16.96l-5.1-3.26m5.1 3.26l5.1 3.26a1.5 1.5 0 002.16-.96l.78-4.42a1.5 1.5 0 00-2.16-.96l-5.1 3.26" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        }
      >
        <div className="space-y-1">
          {state?.input && (
            <div className="rounded bg-gray-100 px-2 py-1">
              <p className="text-[10px] text-gray-400 mb-0.5">输入</p>
              <pre className="text-xs text-gray-600 whitespace-pre-wrap break-all font-mono">
                {JSON.stringify(state.input, null, 2).slice(0, 500)}
              </pre>
            </div>
          )}
          {state?.output && (
            <div className="rounded bg-gray-100 px-2 py-1">
              <p className="text-[10px] text-gray-400 mb-0.5">输出</p>
              <pre className="text-xs text-gray-600 whitespace-pre-wrap break-all font-mono max-h-40 overflow-y-auto">
                {state.output.slice(0, 1000)}
              </pre>
            </div>
          )}
        </div>
      </Collapsible>
    );
  }

  if (part.type === 'agent') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-gray-100 text-gray-600 border border-gray-200">
        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
        </svg>
        {part.name}
      </span>
    );
  }

  return null;
}

function hasVisibleParts(msg: ChatMessage): boolean {
  return msg.parts.some((p) =>
    p.type === 'text' || p.type === 'reasoning' || p.type === 'tool' || p.type === 'agent'
  );
}

export interface AIChatWidgetHandle {
  openWithMessage: (msg: string, options?: { newSession?: boolean; agent?: string }) => void;
}

export default forwardRef<AIChatWidgetHandle, Props>(function AIChatWidget({ directory, engineStatus, projectId, taskId, pageContext, chatModes, onPlanImported, existingSteps, currentTaskName }, ref) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [showSessionList, setShowSessionList] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showMetaInfo, setShowMetaInfo] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [agents, setAgents] = useState<Array<{ name: string; description?: string }>>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** 元信息面板容器 ref，用于点击外部关闭 */
  const metaInfoRef = useRef<HTMLDivElement>(null);
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

  /** 点击外部自动关闭元信息面板 */
  useEffect(() => {
    if (!showMetaInfo) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (metaInfoRef.current && !metaInfoRef.current.contains(e.target as Node)) {
        setShowMetaInfo(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMetaInfo]);

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
    setShowSessionList(false);
    setShowSettingsMenu(false);
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
    setShowSessionList(false);
    lastSentContextRef.current = null;
    inputRef.current?.focus();
  }, [createSession]);

  const handleSwitchSession = useCallback(async (sessionId: string) => {
    log.info(S, 'handleSwitchSession', { sessionId });
    await switchSession(sessionId);
    setShowSessionList(false);
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

  function formatTime(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

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
          <div
            className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0 cursor-grab active:cursor-grabbing select-none"
            onMouseDown={onTitleMouseDown}
          >
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
              </svg>
              <span className="font-semibold text-gray-800 text-sm">AI 助手</span>
              <div className="flex items-center gap-1.5 ml-2">
                {directory && (
                  <span
                    title={directory}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-500 border border-gray-200 max-w-[120px]"
                  >
                    <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                    </svg>
                    <span className="truncate">{directory.split('/').pop()}</span>
                  </span>
                )}
                {/* 当前 AI 上下文模式标签 */}
                {activeMode && (
                  <span
                    title={activeMode.description ?? activeMode.label}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-sky-50 text-sky-600 border border-sky-100"
                  >
                    <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                    </svg>
                    {activeMode.label}
                  </span>
                )}
               </div>
            </div>

            <div className="flex items-center gap-2">
              {/* ── 会话选择器 ── */}
              <div className="relative">
                <button
                  onClick={() => { log.info(S, 'toggle session list'); setShowSessionList((prev) => !prev); setShowSettingsMenu(false); setShowMetaInfo(false); }}
                  className="text-xs text-gray-600 hover:text-gray-800 transition-colors flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 cursor-pointer max-w-[160px]"
                >
                  <span className="truncate">{currentSession?.title || '选择会话'}</span>
                  <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>

                {showSessionList && (
                  <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden z-10">
                    <button
                      onClick={handleNewSession}
                      className="w-full text-left px-3 py-2 text-xs text-sky-500 hover:bg-gray-50 flex items-center gap-2 cursor-pointer border-b border-gray-200"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                      新建会话
                    </button>
                    <div className="max-h-48 overflow-y-auto">
                      {sessions.length === 0 && (
                        <div className="px-3 py-4 text-xs text-gray-400 text-center">暂无会话</div>
                      )}
                      {sessions.map((session) => (
                        <div
                          key={session.id}
                          onClick={() => { if (editingSessionId !== session.id) handleSwitchSession(session.id); }}
                          className={`flex items-center justify-between px-3 py-2 text-xs cursor-pointer hover:bg-gray-50 transition-colors ${
                            session.id === currentSessionId ? 'bg-sky-50 text-sky-700' : 'text-gray-700'
                          }`}
                        >
                          {editingSessionId === session.id ? (
                            <input
                              value={editingTitle}
                              onChange={(e) => setEditingTitle(e.target.value)}
                              onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === 'Enter') {
                                  const t = editingTitle.trim();
                                  if (t) renameSession(session.id, t);
                                  setEditingSessionId(null);
                                } else if (e.key === 'Escape') {
                                  setEditingSessionId(null);
                                }
                              }}
                              onBlur={() => {
                                const t = editingTitle.trim();
                                if (t && t !== session.title) renameSession(session.id, t);
                                setEditingSessionId(null);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              autoFocus
                              className="flex-1 px-1 py-0.5 text-xs border border-sky-300 rounded outline-none focus:border-sky-500 bg-white"
                            />
                          ) : (
                            <span className="truncate flex-1">{session.title}</span>
                          )}
                          <div className="flex items-center gap-0.5 ml-1 shrink-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingSessionId(session.id);
                                setEditingTitle(session.title);
                              }}
                              className="p-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 cursor-pointer"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                              </svg>
                            </button>
                            <button
                              onClick={(e) => handleDeleteSession(e, session.id)}
                              className="p-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-red-500 cursor-pointer"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* ── 元信息面板：工作目录 / 上下文模式 ── */}
              <div className="relative" ref={metaInfoRef}>
                <button
                  onClick={() => { log.info(S, 'toggle meta info'); setShowMetaInfo((prev) => !prev); setShowSettingsMenu(false); setShowSessionList(false); }}
                  className={`p-1 rounded hover:bg-gray-100 transition-colors cursor-pointer ${
                    showMetaInfo ? 'text-sky-500 bg-sky-50' : 'text-gray-400 hover:text-gray-600'
                  }`}
                  title="工作目录信息"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                  </svg>
                </button>

                {showMetaInfo && (
                  <div className="absolute right-0 top-full mt-1 w-[280px] bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden z-10">
                    {/* ── 工作目录 ── */}
                    <div className="px-3 py-1.5 text-[10px] text-gray-400 font-medium uppercase tracking-wider border-b border-gray-100">
                      工作目录
                    </div>
                    <div className="px-3 py-2 text-xs text-gray-700 font-mono break-all leading-relaxed">
                      {directory ?? <span className="text-gray-400 italic">未设置</span>}
                    </div>

                    {/* ── 上下文模式 ── */}
                    {activeMode && (
                      <>
                        <div className="border-t border-gray-100" />
                        <div className="px-3 py-1.5 text-[10px] text-gray-400 font-medium uppercase tracking-wider border-b border-gray-100">
                          上下文模式
                        </div>
                        <div className="px-3 py-2">
                          <div className="text-xs text-gray-700 font-medium">{activeMode.label}</div>
                          {activeMode.description && (
                            <div className="text-[10px] text-gray-400 mt-0.5">{activeMode.description}</div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* ── 统一设置下拉菜单（Agent / 上下文模式 / Debug） ── */}
              <div className="relative">
                <button
                  onClick={() => { log.info(S, 'toggle settings menu'); setShowSettingsMenu((prev) => !prev); setShowSessionList(false); setShowMetaInfo(false); }}
                  className={`p-1 rounded hover:bg-gray-100 transition-colors cursor-pointer ${
                    showSettingsMenu ? 'text-sky-500 bg-sky-50' : 'text-gray-400 hover:text-gray-600'
                  }`}
                  title="设置"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>

                {showSettingsMenu && (
                  <div className="absolute right-0 top-full mt-1 w-60 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden z-10 max-h-[70vh] overflow-y-auto">
                    {/* ── 区块一：选择 Agent ── */}
                    {agents.length > 0 && (
                      <>
                        <div className="px-3 py-1.5 text-[10px] text-gray-400 font-medium uppercase tracking-wider border-b border-gray-100 sticky top-0 bg-white z-10">
                          Agent
                        </div>
                        {agents.map((agent) => {
                          const isActive = agent.name === selectedAgent;
                          return (
                            <button
                              key={agent.name}
                              onClick={() => {
                                log.info(S, 'select agent', { agent: agent.name });
                                setSelectedAgent(agent.name);
                                setShowSettingsMenu(false);
                              }}
                              className={`w-full text-left px-3 py-2 text-xs cursor-pointer transition-colors flex items-start gap-2 ${
                                isActive ? 'bg-sky-50 text-sky-700' : 'text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              <span className={`w-4 shrink-0 flex items-center justify-center ${isActive ? 'text-sky-500' : 'invisible'}`}>
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 12.75l6 6 9-13.5" />
                                </svg>
                              </span>
                              <span className="flex flex-col min-w-0">
                                <span className="font-medium truncate">{agent.name}</span>
                                {agent.description && (
                                  <span className="text-[10px] text-gray-400 mt-0.5 line-clamp-2">{agent.description}</span>
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </>
                    )}

                    {/* ── 区块二：AI 上下文模式 ── */}
                    {chatModes && chatModes.length > 0 && (
                      <>
                        {agents.length > 0 && <div className="border-t border-gray-100" />}
                        <div className="px-3 py-1.5 text-[10px] text-gray-400 font-medium uppercase tracking-wider border-b border-gray-100 sticky top-0 bg-white z-10">
                          AI 上下文模式
                        </div>
                        {chatModes.map((mode) => {
                          const isActive = mode.key === activeModeKey;
                          return (
                            <button
                              key={mode.key}
                              onClick={() => {
                                log.info(S, 'switch chat mode', { key: mode.key });
                                setActiveModeKey(mode.key);
                                setShowSettingsMenu(false);
                              }}
                              className={`w-full text-left px-3 py-2 text-xs cursor-pointer transition-colors flex items-start gap-2 ${
                                isActive
                                  ? 'bg-sky-50 text-sky-700'
                                  : 'text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              <span className={`w-4 shrink-0 flex items-center justify-center ${isActive ? 'text-sky-500' : 'invisible'}`}>
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 12.75l6 6 9-13.5" />
                                </svg>
                              </span>
                              <span className="flex flex-col min-w-0">
                                <span className="font-medium truncate">{mode.label}</span>
                                {mode.description && (
                                  <span className="text-[10px] text-gray-400 mt-0.5 line-clamp-2">{mode.description}</span>
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* 全屏切换按钮 — 所有环境可见 */}
              <button
                onClick={toggleFullscreen}
                className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
                title={isFullscreen ? '还原大小' : '全屏'}
              >
                {isFullscreen ? (
                  /* 还原图标：四向箭头收缩 */
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                  </svg>
                ) : (
                  /* 全屏图标：四向箭头扩张 */
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                  </svg>
                )}
              </button>

              <button
                onClick={() => { log.info(S, 'close chat panel'); setOpen(false); }}
                className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-800 transition-colors cursor-pointer"
                title="收起"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14" />
                </svg>
              </button>
            </div>
          </div>

          {/* 功能三：引擎自动压缩提示 */}
          {compacted && (
            <div className="flex items-center gap-2 px-4 py-1.5 bg-amber-50 border-b border-amber-100 text-[11px] text-amber-600 shrink-0">
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <span>上下文已自动压缩，较早的历史消息已被摘要以节省 token</span>
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && !streamingText && (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 text-sm">
                <svg className="w-12 h-12 mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
                <p>发送消息开始对话</p>
                <p className="text-xs mt-1 text-gray-400">AI 助手将帮助你完成任务</p>
              </div>
            )}

            {messages.map((msg) => {
              const isUser = msg.info.role === 'user';
              if (!hasVisibleParts(msg)) return null;

              if (isUser) {
                const text = msg.parts
                  .filter((p) => p.type === 'text')
                  .map((p) => ('text' in p ? p.text : ''))
                  .join('\n');
                if (!text) return null;
                return (
                  <div key={msg.info.id} className="flex justify-end">
                    <div className="max-w-[80%] rounded-2xl rounded-br-md px-3.5 py-2.5 text-sm leading-relaxed bg-sky-500 text-white">
                      <p className="whitespace-pre-wrap break-words">{text}</p>
                      <p className="text-[10px] mt-1 text-sky-200">{formatTime(msg.info.time.created)}</p>
                    </div>
                  </div>
                );
              }

              return (
                <div key={msg.info.id} className="flex justify-start">
                  <div className="max-w-[80%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm leading-relaxed bg-gray-50 border border-gray-200 text-gray-700 space-y-2">
                    {msg.parts.map((part) => (
                      <PartRenderer
                        key={part.id}
                        part={part}
                        projectId={projectId}
                        taskId={taskId}
                        chatSessionId={currentSessionId ?? undefined}
                        importedPlanTasks={importedPlanTasks}
                        onPlanImported={handlePlanImported}
                        existingSteps={existingSteps}
                        currentTaskName={currentTaskName}
                      />
                    ))}
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] text-gray-400">{formatTime(msg.info.time.created)}</p>
                    </div>
                  </div>
                </div>
              );
            })}

            {isLoading && streamingText && (() => {
              const PLAN_TAG = '<task-plan>';
              const planStart = streamingText.indexOf(PLAN_TAG);

              let visibleText = streamingText;
              let showPlanPlaceholder = false;

              if (planStart !== -1) {
                visibleText = streamingText.slice(0, planStart);
                showPlanPlaceholder = true;
              } else {
                const lastLt = streamingText.lastIndexOf('<');
                if (lastLt !== -1) {
                  const tail = streamingText.slice(lastLt);
                  if (PLAN_TAG.startsWith(tail)) {
                    visibleText = streamingText.slice(0, lastLt);
                    showPlanPlaceholder = true;
                  }
                }
              }

              return (
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm leading-relaxed bg-gray-50 border border-gray-200 text-gray-700">
                    {visibleText && <p className="whitespace-pre-wrap break-words">{visibleText}</p>}
                    {showPlanPlaceholder && (
                      <div className="flex items-center gap-2 py-1.5 px-3 bg-sky-50 border border-sky-100 rounded-lg">
                        <svg className="w-3.5 h-3.5 text-sky-500 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <span className="text-xs text-sky-600">计划生成中...</span>
                      </div>
                    )}
                    {!showPlanPlaceholder && (
                      <span className="inline-block w-1.5 h-4 bg-sky-400 animate-pulse ml-0.5 align-text-bottom" />
                    )}
                  </div>
                </div>
              );
            })()}

            {isLoading && !streamingText && !loadingTimedOut && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-md px-4 py-3 bg-gray-50 border border-gray-200 flex items-center gap-1.5">
                  <span className="w-2 h-2 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}

            {loadingTimedOut && (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm leading-relaxed bg-red-50 border border-red-200 text-red-600">
                  <p>响应超时，AI 助手未能回复。请检查引擎状态或稍后重试。</p>
                  <button
                    type="button"
                    onClick={resetLoading}
                    className="mt-1.5 text-xs text-red-500 underline hover:text-red-700 cursor-pointer"
                  >
                    关闭提示
                  </button>
                </div>
              </div>
            )}

            {sessionBroken && (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm leading-relaxed bg-amber-50 border border-amber-200 text-amber-700">
                  <p>当前会话模型配置异常，AI 无法回复。</p>
                  <div className="flex gap-2 mt-1.5">
                    <button
                      type="button"
                      onClick={() => retryInNewSession(effectivePageContext)}
                      className="text-xs bg-amber-500 text-white px-2.5 py-1 rounded hover:bg-amber-600 cursor-pointer"
                    >
                      新建会话并重试
                    </button>
                    <button
                      type="button"
                      onClick={dismissSessionBroken}
                      className="text-xs text-amber-500 underline hover:text-amber-700 cursor-pointer"
                    >
                      关闭
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={handleSubmit} className="shrink-0 border-t border-gray-200 p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={engineDisabled ? '请先配置引擎...' : '输入消息...'}
                disabled={isLoading || engineDisabled}
                rows={1}
                className="flex-1 px-3 py-2 text-gray-800 bg-white border border-gray-300 shadow-sm rounded-lg text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all placeholder-gray-400 resize-none min-h-[36px] max-h-[120px] disabled:opacity-50"
                style={{ height: 'auto' }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = Math.min(target.scrollHeight, 120) + 'px';
                }}
              />
              {isLoading ? (
                <button
                  type="button"
                  onClick={abortGeneration}
                  title="停止生成"
                  className="shrink-0 w-9 h-9 bg-red-500 hover:bg-red-600 rounded-lg flex items-center justify-center transition-colors cursor-pointer"
                >
                  <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" rx="1.5" />
                  </svg>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim() || engineDisabled}
                  title="发送"
                  className="shrink-0 w-9 h-9 bg-sky-500 hover:bg-sky-600 disabled:bg-gray-300 disabled:opacity-50 rounded-lg flex items-center justify-center transition-colors cursor-pointer disabled:cursor-not-allowed"
                >
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                  </svg>
                </button>
              )}
            </div>
          </form>

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
