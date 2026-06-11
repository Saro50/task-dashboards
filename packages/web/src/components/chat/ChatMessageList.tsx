import type { ChatMessage } from '@/types/chat';
import type { Step } from '@/types/step';
import { PartRenderer, hasVisibleParts } from './PartRenderer';

const S = 'ChatMessageList';

interface Props {
  messages: ChatMessage[];
  streamingText: string;
  isLoading: boolean;
  loadingTimedOut: boolean;
  sessionBroken: boolean;
  compacted: boolean;
  projectId?: string;
  taskId?: string;
  currentSessionId?: string;
  importedPlanTasks: Set<string>;
  onPlanImported: (name: string) => void;
  existingSteps?: Step[];
  currentTaskName?: string;
  effectivePageContext?: string;
  onRetryInNewSession: (context?: string) => void;
  onDismissSessionBroken: () => void;
  onResetLoading: () => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export default function ChatMessageList({
  messages,
  streamingText,
  isLoading,
  loadingTimedOut,
  sessionBroken,
  compacted,
  projectId,
  taskId,
  currentSessionId,
  importedPlanTasks,
  onPlanImported,
  existingSteps,
  currentTaskName,
  effectivePageContext,
  onRetryInNewSession,
  onDismissSessionBroken,
  onResetLoading,
  messagesEndRef,
}: Props) {
  return (
    <>
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
                    chatSessionId={currentSessionId}
                    importedPlanTasks={importedPlanTasks}
                    onPlanImported={onPlanImported}
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
                onClick={onResetLoading}
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
                  onClick={() => onRetryInNewSession(effectivePageContext)}
                  className="text-xs bg-amber-500 text-white px-2.5 py-1 rounded hover:bg-amber-600 cursor-pointer"
                >
                  新建会话并重试
                </button>
                <button
                  type="button"
                  onClick={onDismissSessionBroken}
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
    </>
  );
}
