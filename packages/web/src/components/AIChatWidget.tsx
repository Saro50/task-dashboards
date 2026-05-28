import { useState, useRef, useEffect, useCallback, type KeyboardEvent, type FormEvent } from 'react';
import type { EngineStatus } from './Layout';
import { useChat } from '@/hooks/useChat';
import { log } from '@/utils/log';
import type { ChatMessage, ChatPart } from '@/types/chat';

const S = 'AIChatWidget';

interface Props {
  directory?: string;
  engineStatus: EngineStatus;
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-3 h-3 text-gray-500 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
      fill="none" stroke="currentColor" viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

function ToolStatusLabel({ status }: { status: string }) {
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-yellow-400">
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
      <span className="inline-flex items-center gap-1 text-[10px] text-green-400">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        完成
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-red-400">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
        错误
      </span>
    );
  }
  return (
    <span className="text-[10px] text-gray-500">等待中</span>
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
    <div className="rounded-lg bg-dark-100/50 border border-gray-700/50 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-400 hover:text-gray-300 hover:bg-dark-100 transition-colors cursor-pointer"
      >
        <ChevronIcon open={open} />
        {icon}
        <span className="truncate flex-1 text-left">{title}</span>
      </button>
      {open && <div className="px-2.5 pb-2">{children}</div>}
    </div>
  );
}

function PartRenderer({ part }: { part: ChatPart }) {
  if (part.type === 'text' && part.text) {
    return <p className="whitespace-pre-wrap break-words">{part.text}</p>;
  }

  if (part.type === 'reasoning' && part.text) {
    const t = part.text;
    const preview = t.length > 60 ? t.slice(0, 60) + '...' : t;
    return (
      <Collapsible
        title={<span className="italic text-gray-500">思考: {preview}</span>}
        icon={
          <svg className="w-3 h-3 text-gray-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        }
      >
        <p className="text-xs text-gray-500 italic whitespace-pre-wrap break-words border-l-2 border-gray-600 pl-2 leading-relaxed">
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
            <span className="font-mono text-gray-300">{title}</span>
            <ToolStatusLabel status={state?.status || 'pending'} />
            {preview && <span className="text-gray-600 truncate hidden sm:inline">{preview}</span>}
          </span>
        }
        icon={
          <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        }
      >
        <div className="space-y-1">
          {state?.input && (
            <div className="rounded bg-dark-300/80 px-2 py-1">
              <p className="text-[10px] text-gray-500 mb-0.5">输入</p>
              <pre className="text-xs text-gray-400 whitespace-pre-wrap break-all font-mono">
                {JSON.stringify(state.input, null, 2).slice(0, 500)}
              </pre>
            </div>
          )}
          {state?.output && (
            <div className="rounded bg-dark-300/80 px-2 py-1">
              <p className="text-[10px] text-gray-500 mb-0.5">输出</p>
              <pre className="text-xs text-gray-400 whitespace-pre-wrap break-all font-mono max-h-40 overflow-y-auto">
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
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-gray-700/50 text-gray-400 border border-gray-600/50">
        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
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

export default function AIChatWidget({ directory, engineStatus }: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [showSessionList, setShowSessionList] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const {
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
  } = useChat(directory);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingText, scrollToBottom]);

  useEffect(() => {
    log.info(S, 'open changed', { open, engineStatus, directory });
    if (open) {
      loadSessions();
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

  const handleNewSession = useCallback(async () => {
    await createSession('新会话');
    setShowSessionList(false);
    inputRef.current?.focus();
  }, [createSession]);

  const handleSwitchSession = useCallback(async (sessionId: string) => {
    await switchSession(sessionId);
    setShowSessionList(false);
  }, [switchSession]);

  const handleDeleteSession = useCallback(async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
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

  return (
    <>
      <button
        onClick={handleToggle}
        title={engineDisabled ? '请先配置引擎' : open ? '关闭聊天' : '打开 AI 助手'}
        className={`fixed bottom-6 right-6 z-[100] w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all duration-200 cursor-pointer ${
          open
            ? 'bg-gray-700 hover:bg-gray-600 scale-100'
            : engineDisabled
              ? 'bg-gray-600 cursor-not-allowed opacity-60'
              : 'bg-primary-600 hover:bg-primary-700 hover:scale-110 shadow-primary-500/25 hover:shadow-primary-500/40'
        }`}
      >
        {open ? (
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        )}
      </button>

      {open && (
        <div className="fixed bottom-24 right-6 z-[100] w-[400px] max-w-[calc(100vw-2rem)] h-[560px] max-h-[70vh] bg-dark-300 border border-gray-700 rounded-2xl shadow-2xl flex flex-col animate-[scaleIn_0.2s_ease_both]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-lg">🤖</span>
              <span className="font-bold text-white text-sm">AI 助手</span>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <button
                  onClick={() => setShowSessionList((prev) => !prev)}
                  className="text-xs text-gray-400 hover:text-white transition-colors flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-700 cursor-pointer max-w-[160px]"
                >
                  <span className="truncate">{currentSession?.title || '选择会话'}</span>
                  <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {showSessionList && (
                  <div className="absolute right-0 top-full mt-1 w-56 bg-dark-50 border border-gray-700 rounded-xl shadow-xl overflow-hidden z-10">
                    <button
                      onClick={handleNewSession}
                      className="w-full text-left px-3 py-2 text-xs text-primary-400 hover:bg-gray-700 flex items-center gap-2 cursor-pointer border-b border-gray-700"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      新建会话
                    </button>
                    <div className="max-h-48 overflow-y-auto">
                      {sessions.length === 0 && (
                        <div className="px-3 py-4 text-xs text-gray-500 text-center">暂无会话</div>
                      )}
                      {sessions.map((session) => (
                        <div
                          key={session.id}
                          onClick={() => handleSwitchSession(session.id)}
                          className={`flex items-center justify-between px-3 py-2 text-xs cursor-pointer hover:bg-gray-700 transition-colors ${
                            session.id === currentSessionId ? 'bg-gray-700/50 text-white' : 'text-gray-300'
                          }`}
                        >
                          <span className="truncate flex-1">{session.title}</span>
                          <button
                            onClick={(e) => handleDeleteSession(e, session.id)}
                            className="ml-2 p-0.5 rounded hover:bg-gray-600 text-gray-500 hover:text-red-400 shrink-0 cursor-pointer"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && !streamingText && (
              <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm">
                <span className="text-3xl mb-3">💬</span>
                <p>发送消息开始对话</p>
                <p className="text-xs mt-1 text-gray-600">AI 助手将帮助你完成任务</p>
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
                    <div className="max-w-[80%] rounded-2xl rounded-br-md px-3.5 py-2.5 text-sm leading-relaxed bg-primary-600 text-white">
                      <p className="whitespace-pre-wrap break-words">{text}</p>
                      <p className="text-[10px] mt-1 text-primary-200">{formatTime(msg.info.time.created)}</p>
                    </div>
                  </div>
                );
              }

              return (
                <div key={msg.info.id} className="flex justify-start">
                  <div className="max-w-[80%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm leading-relaxed bg-dark-50 border border-gray-700 text-gray-200 space-y-2">
                    {msg.parts.map((part) => (
                      <PartRenderer key={part.id} part={part} />
                    ))}
                    <p className="text-[10px] text-gray-500">{formatTime(msg.info.time.created)}</p>
                  </div>
                </div>
              );
            })}

            {isLoading && streamingText && (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm leading-relaxed bg-dark-50 border border-gray-700 text-gray-200">
                  <p className="whitespace-pre-wrap break-words">{streamingText}</p>
                  <span className="inline-block w-1.5 h-4 bg-primary-400 animate-pulse ml-0.5 align-text-bottom" />
                </div>
              </div>
            )}

            {isLoading && !streamingText && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-md px-4 py-3 bg-dark-50 border border-gray-700 flex items-center gap-1.5">
                  <span className="w-2 h-2 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={handleSubmit} className="shrink-0 border-t border-gray-700 p-3">
            {isLoading && (
              <button
                type="button"
                onClick={abortGeneration}
                className="w-full mb-2 text-xs text-red-400 hover:text-red-300 flex items-center justify-center gap-1 py-1 rounded hover:bg-red-900/20 transition-colors cursor-pointer"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
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
                className="flex-1 bg-dark-50 border border-gray-600 rounded-xl text-white text-sm px-3 py-2 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/20 transition-all placeholder-gray-500 resize-none min-h-[36px] max-h-[120px] disabled:opacity-50"
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
                className="shrink-0 w-9 h-9 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-700 disabled:opacity-50 rounded-xl flex items-center justify-center transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
