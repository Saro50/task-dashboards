import { useState, useRef, useEffect } from 'react';
import type { ChatSession, ChatMode } from '@/types/chat';
import { log } from '@/utils/log';

const S = 'ChatTitleBar';

interface Props {
  directory?: string;
  activeMode: ChatMode | null;
  activeModeKey: string | null;
  chatModes?: ChatMode[];
  agents: Array<{ name: string; description?: string }>;
  selectedAgent: string;
  onSelectAgent: (name: string) => void;
  /** 切换 AI 上下文模式，由父组件维护 activeModeKey 状态 */
  onSelectMode: (key: string) => void;
  sessions: ChatSession[];
  currentSessionId: string | null;
  currentSession: ChatSession | null;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onNewSession: () => Promise<void>;
  onSwitchSession: (id: string) => Promise<void>;
  onDeleteSession: (e: React.MouseEvent, id: string) => Promise<void>;
  onRenameSession: (id: string, title: string) => Promise<void>;
  onClose: () => void;
  /** 标题栏区域鼠标按下事件，用于拖拽移动面板 */
  onTitleMouseDown: (e: React.MouseEvent) => void;
}

export default function ChatTitleBar({
  directory,
  activeMode,
  activeModeKey,
  chatModes,
  agents,
  selectedAgent,
  onSelectAgent,
  onSelectMode,
  sessions,
  currentSessionId,
  currentSession,
  isFullscreen,
  onToggleFullscreen,
  onNewSession,
  onSwitchSession,
  onDeleteSession,
  onRenameSession,
  onClose,
  onTitleMouseDown,
}: Props) {
  const [showSessionList, setShowSessionList] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showMetaInfo, setShowMetaInfo] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  /** 元信息面板容器 ref，用于点击外部关闭 */
  const metaInfoRef = useRef<HTMLDivElement>(null);

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

  return (
    <div
      className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0 cursor-grab active:cursor-grabbing select-none"
      onMouseDown={onTitleMouseDown}
    >
      <div className="flex items-center gap-2">
        <svg className="w-5 h-5 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 01-2.455 2.456z" />
        </svg>
        <span className="font-semibold text-gray-800 text-sm">AI 助手</span>

        {/* ── 会话选择器（标题旁） ── */}
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
            <div className="absolute left-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden z-10">
              <button
                onClick={() => { setShowSessionList(false); onNewSession(); }}
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
                    onClick={() => { if (editingSessionId !== session.id) { setShowSessionList(false); onSwitchSession(session.id); } }}
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
                            if (t) onRenameSession(session.id, t);
                            setEditingSessionId(null);
                          } else if (e.key === 'Escape') {
                            setEditingSessionId(null);
                          }
                        }}
                        onBlur={() => {
                          const t = editingTitle.trim();
                          if (t && t !== session.title) onRenameSession(session.id, t);
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
                        onClick={(e) => onDeleteSession(e, session.id)}
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

      <div className="flex items-center gap-2">
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
                          onSelectAgent(agent.name);
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
                        <span className="flex flex-col min-w-0 flex-1">
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
                          onSelectMode(mode.key);
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
          onClick={onToggleFullscreen}
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
          onClick={onClose}
          className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-800 transition-colors cursor-pointer"
          title="收起"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14" />
          </svg>
        </button>
      </div>
    </div>
  );
}
