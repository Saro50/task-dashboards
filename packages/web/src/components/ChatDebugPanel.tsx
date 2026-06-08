/**
 * ChatDebugPanel — AI 聊天调试面板（仅开发环境）
 *
 * 上下游影响说明：
 * - 上游：由 AIChatWidget 在 import.meta.env.DEV 时渲染，接收 pageContext、
 *   useChat.lastSent、debugSource（来自页面）、messages（来自 useChat）作为数据源。
 * - 下游：不产生任何副作用，纯只读展示组件。
 */
import { useState, useMemo } from 'react';
import type { ChatMessage } from '@/types/chat';
import type { Project } from '@/types/project';
import type { TaskTopic } from '@/types/topic';
import type { Task } from '@/types/task';
import type { LastSentSnapshot } from '@/hooks/useChat';

/* ── 类型定义 ─────────────────────────────────────── */

export interface ContextSource {
  type: 'topic' | 'task';
  project?: Project | null;
  topics?: TaskTopic[];
  topic?: TaskTopic | null;
  tasks?: Task[];
}

interface Props {
  pageContext?: string;
  lastSent: LastSentSnapshot | null;
  debugSource?: ContextSource;
  messages: ChatMessage[];
}

type TabId = 'context' | 'lastSent' | 'source' | 'history';

/* ── 工具函数 ─────────────────────────────────────── */

/** 粗略估算 token 数：中英混合内容约 3.5 字符/token */
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** 将任意 JSON 值格式化为带缩进的字符串，做安全截断 */
function safeStringify(obj: unknown, maxLen = 5000): string {
  try {
    const str = JSON.stringify(obj, null, 2);
    return str.length > maxLen ? str.slice(0, maxLen) + '\n... (截断)' : str;
  } catch {
    return String(obj);
  }
}

/* ── 复制按钮 ─────────────────────────────────────── */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="text-[10px] text-gray-400 hover:text-sky-500 transition-colors cursor-pointer shrink-0"
    >
      {copied ? '已复制' : '复制'}
    </button>
  );
}

/* ── 标签页：当前上下文 ───────────────────────────── */

function ContextTab({ pageContext }: { pageContext?: string }) {
  if (!pageContext) {
    return <EmptyHint text="当前页面未注入 pageContext" />;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-[10px] text-gray-400">
        <span>字符数: {pageContext.length.toLocaleString()} · 预估 Token: ~{estimateTokens(pageContext).toLocaleString()}</span>
        <CopyButton text={pageContext} />
      </div>
      <pre className="text-[11px] text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-auto whitespace-pre-wrap break-all max-h-[180px] leading-relaxed">
        {pageContext}
      </pre>
    </div>
  );
}

/* ── 标签页：最近发送 ─────────────────────────────── */

function LastSentTab({ lastSent }: { lastSent: LastSentSnapshot | null }) {
  if (!lastSent) {
    return <EmptyHint text="尚未发送任何消息" />;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 text-[10px] text-gray-400">
        <span>时间: {formatTime(lastSent.timestamp)}</span>
        <span>Agent: <span className="text-gray-600 font-medium">{lastSent.agent}</span></span>
        <span>Context: <span className={lastSent.context ? 'text-green-500' : 'text-gray-400'}>{lastSent.context ? `有 (${lastSent.context.length} 字符)` : '无'}</span></span>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-gray-400 font-medium">用户消息 (text)</span>
          <CopyButton text={lastSent.text} />
        </div>
        <pre className="text-[11px] text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-2 overflow-auto whitespace-pre-wrap break-all max-h-[60px] leading-relaxed">
          {lastSent.text}
        </pre>
      </div>
      {lastSent.context && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-gray-400 font-medium">系统上下文 (system / pageContext)</span>
            <CopyButton text={lastSent.context} />
          </div>
          <pre className="text-[11px] text-gray-700 bg-orange-50 border border-orange-200 rounded-lg p-2 overflow-auto whitespace-pre-wrap break-all max-h-[120px] leading-relaxed">
            {lastSent.context}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ── 标签页：数据源 ───────────────────────────────── */

function SourceTab({ debugSource }: { debugSource?: ContextSource }) {
  if (!debugSource) {
    return <EmptyHint text="未提供数据源信息" />;
  }

  const summary = debugSource.type === 'topic'
    ? `主题页 · ${debugSource.topics?.length ?? 0} 个主题`
    : `任务页 · ${debugSource.tasks?.length ?? 0} 个任务`;

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[10px] text-gray-400">{summary}</div>
      <div className="flex flex-col gap-1.5">
        {debugSource.project && (
          <SourceSection label="Project" data={debugSource.project} />
        )}
        {debugSource.type === 'topic' && debugSource.topics && (
          <SourceSection label={`Topics (${debugSource.topics.length})`} data={debugSource.topics} />
        )}
        {debugSource.type === 'task' && (
          <>
            {debugSource.topic && <SourceSection label="Current Topic" data={debugSource.topic} />}
            {debugSource.tasks && <SourceSection label={`Tasks (${debugSource.tasks.length})`} data={debugSource.tasks} />}
          </>
        )}
      </div>
    </div>
  );
}

function SourceSection({ label, data }: { label: string; data: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const jsonText = useMemo(() => safeStringify(data), [data]);
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center justify-between px-2 py-1 text-[10px] text-gray-500 hover:bg-gray-50 cursor-pointer transition-colors"
      >
        <span className="font-medium">{label}</span>
        <span className="text-gray-400">{expanded ? '收起' : '展开'}</span>
      </button>
      {expanded && (
        <pre className="text-[10px] text-gray-600 bg-gray-50 p-2 overflow-auto whitespace-pre-wrap break-all max-h-[120px] border-t border-gray-200 leading-relaxed">
          {jsonText}
        </pre>
      )}
    </div>
  );
}

/* ── 标签页：历史 system ──────────────────────────── */

function HistoryTab({ messages }: { messages: ChatMessage[] }) {
  const userMsgsWithSystem = useMemo(
    () => messages.filter((m) => m.info.role === 'user' && m.info.system),
    [messages],
  );

  if (userMsgsWithSystem.length === 0) {
    return <EmptyHint text="历史消息中暂无 system 字段（发送消息后会在此显示）" />;
  }

  return (
    <div className="flex flex-col gap-1.5 max-h-[200px] overflow-y-auto">
      {userMsgsWithSystem.map((msg) => (
        <HistoryItem key={msg.info.id} msg={msg} />
      ))}
    </div>
  );
}

function HistoryItem({ msg }: { msg: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  const systemText = msg.info.system ?? '';
  const textPart = msg.parts.find((p) => p.type === 'text');

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center justify-between px-2 py-1.5 text-[10px] hover:bg-gray-50 cursor-pointer transition-colors"
      >
        <span className="text-gray-600 truncate flex-1 text-left">
          {formatTime(msg.info.time.created * 1000)} · {textPart?.text?.slice(0, 30) ?? '(无文本)'}
        </span>
        <span className="text-gray-400 shrink-0 ml-2">{systemText.length} 字符</span>
      </button>
      {expanded && (
        <div className="border-t border-gray-200">
          <div className="flex items-center justify-between px-2 py-0.5 bg-gray-50">
            <span className="text-[10px] text-gray-400">system 字段</span>
            <CopyButton text={systemText} />
          </div>
          <pre className="text-[10px] text-gray-600 bg-white p-2 overflow-auto whitespace-pre-wrap break-all max-h-[100px] leading-relaxed">
            {systemText}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ── 空状态提示 ───────────────────────────────────── */

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center py-6 text-[11px] text-gray-400">
      {text}
    </div>
  );
}

/* ── 主组件 ───────────────────────────────────────── */

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'context', label: '当前上下文' },
  { id: 'lastSent', label: '最近发送' },
  { id: 'source', label: '数据源' },
  { id: 'history', label: '历史 system' },
];

export function ChatDebugPanel({ pageContext, lastSent, debugSource, messages }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('context');

  return (
    <div className="border-b border-gray-200 bg-white shrink-0">
      {/* 标签栏 */}
      <div className="flex items-center gap-0.5 px-2 pt-2 border-b border-gray-100">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-2 py-1 text-[10px] rounded-t cursor-pointer transition-colors ${
              activeTab === tab.id
                ? 'text-sky-600 bg-sky-50 border-b-2 border-sky-400 font-medium'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="px-3 py-2 max-h-[240px] overflow-y-auto">
        {activeTab === 'context' && <ContextTab pageContext={pageContext} />}
        {activeTab === 'lastSent' && <LastSentTab lastSent={lastSent} />}
        {activeTab === 'source' && <SourceTab debugSource={debugSource} />}
        {activeTab === 'history' && <HistoryTab messages={messages} />}
      </div>
    </div>
  );
}
