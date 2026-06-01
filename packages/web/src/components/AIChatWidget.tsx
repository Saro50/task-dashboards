import { useState, useRef, useEffect, useCallback, useImperativeHandle, forwardRef, type KeyboardEvent, type FormEvent } from 'react';
import type { EngineStatus } from './Layout';
import { useChat } from '@/hooks/useChat';
import { log } from '@/utils/log';
import { unwrap } from '@/api/lib';
import type { ChatMessage, ChatPart } from '@/types/chat';
import type { TaskPlan } from '@/types/task';
import TaskPlanPreview from './TaskPlanPreview';

const S = 'AIChatWidget';

interface Props {
  directory?: string;
  engineStatus: EngineStatus;
  projectId?: string;
  topicId?: string;
  onPlanImported?: () => void;
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

function PartRenderer({ part, projectId, topicId, chatSessionId, importedPlanTopics, onPlanImported }: {
  part: ChatPart;
  projectId?: string;
  topicId?: string;
  chatSessionId?: string;
  importedPlanTopics: Set<string>;
  onPlanImported: (topicName: string) => void;
}) {
  if (part.type === 'text' && part.text) {
    const text = part.text;
    const taskPlanRegex = /<task-plan>\n?([\s\S]*?)\n?<\/task-plan>/g;
    const segments: Array<{ type: 'text' | 'plan'; content: string | TaskPlan }> = [];
    let lastIndex = 0;
    let match;

    while ((match = taskPlanRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
      }
      try {
        const plan = JSON.parse(match[1]);
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
            <TaskPlanPreview
              key={i}
              plan={seg.content as TaskPlan}
              projectId={projectId}
              topicId={topicId}
              chatSessionId={chatSessionId}
              imported={importedPlanTopics.has((seg.content as TaskPlan).topic)}
              onPlanImported={onPlanImported}
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

export default forwardRef<AIChatWidgetHandle, Props>(function AIChatWidget({ directory, engineStatus, projectId, topicId, onPlanImported }, ref) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [showSessionList, setShowSessionList] = useState(false);
  const [showAgentList, setShowAgentList] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [agents, setAgents] = useState<Array<{ name: string; description?: string }>>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [fabPos, setFabPos] = useState(() => ({ x: window.innerWidth - 72, y: window.innerHeight - 72 }));
  const [chatPos, setChatPos] = useState<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const dragStart = useRef({ mx: 0, my: 0, fx: 0, fy: 0 });
  const chatDragging = useRef(false);
  const chatDragStart = useRef({ mx: 0, my: 0, cx: 0, cy: 0 });

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
    importedPlanTopics,
    addImportedPlanTopic,
  } = useChat(directory);

  const handlePlanImported = useCallback((topicName: string) => {
    addImportedPlanTopic(topicName);
    onPlanImported?.();
  }, [addImportedPlanTopic, onPlanImported]);

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
    inputRef.current?.focus();
  }, [createSession]);

  const handleSwitchSession = useCallback(async (sessionId: string) => {
    log.info(S, 'handleSwitchSession', { sessionId });
    await switchSession(sessionId);
    setShowSessionList(false);
  }, [switchSession]);

  const handleDeleteSession = useCallback(async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    log.info(S, 'handleDeleteSession', { sessionId });
    await deleteSession(sessionId);
  }, [deleteSession]);

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
    await sendMessage(text);
    log.info(S, 'sendMessage returned');
  }, [input, isLoading, currentSessionId, createSession, switchSession, sendMessage]);

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

  const [chatSize, setChatSize] = useState({ w: 480, h: 640 });
  const resizingRef = useRef(false);
  const startRef = useRef({ x: 0, y: 0, w: 0, h: 0 });

  const initialChatPos = useCallback((): { x: number; y: number } => {
    return {
      x: Math.max(8, fabPos.x - chatSize.w),
      y: Math.max(8, window.innerHeight - fabPos.y - chatSize.h),
    };
  }, [fabPos.x, fabPos.y, chatSize.w, chatSize.h]);

  const onTitlePointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, select, input')) return;
    e.preventDefault();
    chatDragging.current = false;
    const pos = chatPos ?? initialChatPos();
    chatDragStart.current = { mx: e.clientX, my: e.clientY, cx: pos.x, cy: pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [chatPos, initialChatPos]);

  const onTitlePointerMove = useCallback((e: React.PointerEvent) => {
    if (e.buttons === 0) return;
    const dx = e.clientX - chatDragStart.current.mx;
    const dy = e.clientY - chatDragStart.current.my;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) chatDragging.current = true;
    if (!chatDragging.current) return;
    const nx = Math.min(Math.max(chatDragStart.current.cx + dx, 0), window.innerWidth - chatSize.w);
    const ny = Math.min(Math.max(chatDragStart.current.cy + dy, 0), window.innerHeight - chatSize.h);
    setChatPos({ x: nx, y: ny });
  }, [chatSize.w, chatSize.h]);

  const onTitlePointerUp = useCallback(() => {
  }, []);

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
      <button
        onPointerDown={onFabPointerDown}
        onPointerMove={onFabPointerMove}
        onPointerUp={onFabPointerUp}
        title={engineDisabled ? '请先配置引擎' : open ? '关闭聊天' : '打开 AI 助手'}
        className="fixed z-[100] w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-colors duration-200 cursor-pointer touch-none select-none"
        style={{
          left: fabPos.x,
          top: fabPos.y,
        }}
      >
        <div className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg ${
          open
            ? 'bg-gray-800 hover:bg-gray-700'
            : engineDisabled
              ? 'bg-gray-400 cursor-not-allowed opacity-60'
              : 'bg-sky-500 hover:bg-sky-600 shadow-sky-500/25'
        }`}>
          {open ? (
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
          )}
        </div>
      </button>

      {open && (
        <div
          className="fixed z-[100] bg-white border border-gray-200 rounded-xl shadow-2xl flex flex-col animate-[scaleIn_0.2s_ease_both]"
          style={{
            width: chatSize.w,
            height: chatSize.h,
            maxWidth: 'calc(100vw - 2rem)',
            maxHeight: 'calc(100vh - 2rem)',
            left: chatPos?.x ?? Math.max(8, fabPos.x - chatSize.w),
            top: chatPos?.y ?? Math.max(8, window.innerHeight - fabPos.y - chatSize.h),
          }}
        >
          <div
            className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0 cursor-grab active:cursor-grabbing select-none touch-none"
            onPointerDown={onTitlePointerDown}
            onPointerMove={onTitlePointerMove}
            onPointerUp={onTitlePointerUp}
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
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <button
                  onClick={() => { log.info(S, 'toggle session list'); setShowSessionList((prev) => !prev); setShowAgentList(false); }}
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

              <div className="relative">
                <button
                  onClick={() => { log.info(S, 'toggle agent list'); setShowAgentList((prev) => !prev); setShowSessionList(false); }}
                  className="text-xs text-gray-600 hover:text-gray-800 transition-colors flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 cursor-pointer"
                >
                  <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span>{selectedAgent}</span>
                </button>

                {showAgentList && (
                  <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden z-10">
                    {agents.map((agent) => (
                      <div
                        key={agent.name}
                        onClick={() => { log.info(S, 'select agent', { agent: agent.name }); setSelectedAgent(agent.name); setShowAgentList(false); }}
                        className={`flex flex-col px-3 py-2 text-xs cursor-pointer hover:bg-gray-50 transition-colors ${
                          agent.name === selectedAgent ? 'bg-sky-50 text-sky-700' : 'text-gray-700'
                        }`}
                      >
                        <span className="font-medium">{agent.name}</span>
                        {agent.description && (
                          <span className="text-[10px] text-gray-400 mt-0.5 line-clamp-2">{agent.description}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={() => { log.info(S, 'close chat panel'); setOpen(false); }}
                className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-800 transition-colors cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
            </div>
          </div>

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
                        topicId={topicId}
                        chatSessionId={currentSessionId ?? undefined}
                        importedPlanTopics={importedPlanTopics}
                        onPlanImported={handlePlanImported}
                      />
                    ))}
                    <p className="text-[10px] text-gray-400">{formatTime(msg.info.time.created)}</p>
                  </div>
                </div>
              );
            })}

            {isLoading && streamingText && (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm leading-relaxed bg-gray-50 border border-gray-200 text-gray-700">
                  <p className="whitespace-pre-wrap break-words">{streamingText}</p>
                  <span className="inline-block w-1.5 h-4 bg-sky-400 animate-pulse ml-0.5 align-text-bottom" />
                </div>
              </div>
            )}

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
                      onClick={retryInNewSession}
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
            {isLoading && (
              <button
                type="button"
                onClick={abortGeneration}
                className="w-full mb-2 text-xs text-red-500 hover:text-red-600 flex items-center justify-center gap-1 py-1 rounded hover:bg-red-50 transition-colors cursor-pointer"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 10a1.5 1.5 0 011.5-1.5h3A1.5 1.5 0 0115 10v4a1.5 1.5 0 01-1.5 1.5h-3A1.5 1.5 0 019 14v-4z" />
                </svg>
                停止生成
              </button>
            )}
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
              <button
                type="submit"
                disabled={!input.trim() || isLoading || engineDisabled}
                className="shrink-0 w-9 h-9 bg-sky-500 hover:bg-sky-600 disabled:bg-gray-300 disabled:opacity-50 rounded-lg flex items-center justify-center transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
              </button>
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
