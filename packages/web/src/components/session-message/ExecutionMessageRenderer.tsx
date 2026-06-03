import { AssistantContent } from './AssistantContent';
import type { SessionMessage } from '@/types/session-message';

export default function ExecutionMessageRenderer({ messages }: { messages: SessionMessage[] }) {
  const filtered = messages.filter(
    (m) => m.type === 'user' || m.type === 'assistant',
  );

  if (filtered.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-gray-400 py-2">
        <svg className="w-3.5 h-3.5 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Agent 正在处理...
      </div>
    );
  }

  return (
    <div className="space-y-3 max-h-96 overflow-y-auto">
      {filtered.map((msg) => {
        if (msg.type === 'user') {
          return (
            <div key={msg.id} className="rounded-lg bg-sky-50 border border-sky-100 px-3 py-2">
              <p className="text-xs text-sky-800 whitespace-pre-wrap break-words leading-relaxed">{msg.text}</p>
            </div>
          );
        }
        if (msg.type === 'assistant') {
          return (
            <div key={msg.id} className="space-y-1">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[10px] text-gray-400 font-mono">{msg.agent}</span>
                {msg.error && <span className="text-[10px] text-red-500">错误: {msg.error.message}</span>}
                {!msg.finish && !msg.error && (
                  <svg className="w-3 h-3 animate-pulse text-sky-400" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
              </div>
              <AssistantContent content={msg.content} />
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
