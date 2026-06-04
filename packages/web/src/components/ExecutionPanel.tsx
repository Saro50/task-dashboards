/**
 * 全局执行面板 — 在导航栏中显示当前项目的执行列表。
 *
 * 面板靠右对齐，固定宽度约 1/3 屏，最大高度 1/3 屏。
 * 执行中的卡片展示最后一条 AI 消息摘要（限制高度，超出省略号）。
 * 暂停的执行也会展示在面板中。
 */
import { useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useActiveExecutions } from '@/hooks/useActiveExecutions';
import type { SessionMessage, SessionMessageAssistant, AssistantTool } from '@/types/session-message';

const statusLabel: Record<string, { text: string; color: string }> = {
  CREATING_WORKTREE: { text: '创建 worktree', color: 'text-amber-600' },
  RUNNING: { text: '执行中', color: 'text-sky-600' },
  COMPLETED: { text: '已完成', color: 'text-green-600' },
  FAILED: { text: '失败', color: 'text-red-600' },
  STOPPED: { text: '已暂停', color: 'text-amber-600' },
  MERGED: { text: '已合并', color: 'text-gray-400' },
};

function getLastAssistantMsg(messages: SessionMessage[]): SessionMessageAssistant | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.type === 'assistant') return messages[i] as SessionMessageAssistant;
  }
  return null;
}

function extractSummary(msg: SessionMessageAssistant | null): { text: string; tool?: { name: string; status: string } } | null {
  if (!msg) return null;
  for (let i = msg.content.length - 1; i >= 0; i--) {
    const part = msg.content[i];
    if (part.type === 'text' && part.text.trim()) {
      return { text: part.text.trim() };
    }
    if (part.type === 'tool') {
      const t = part as AssistantTool;
      return { text: '', tool: { name: t.name, status: t.state.status } };
    }
  }
  return null;
}

const toolStatusIcon: Record<string, string> = {
  running: 'text-yellow-500',
  completed: 'text-green-500',
  error: 'text-red-500',
  pending: 'text-gray-400',
};

export default function ExecutionPanel() {
  const location = useLocation();
  const navigate = useNavigate();
  const match = location.pathname.match(/\/project\/([^/]+)/);
  const projectId = match?.[1];
  const { executions, executionMessages, hasRunning, stopExecution, startExecution } = useActiveExecutions(projectId);
  const [expanded, setExpanded] = useState(false);

  const running = executions.filter(
    (e) => e.status === 'RUNNING' || e.status === 'CREATING_WORKTREE',
  );
  const recent = executions.filter(
    (e) => e.status === 'COMPLETED' || e.status === 'STOPPED' || e.status === 'FAILED',
  );

  const toggle = useCallback(() => setExpanded((v) => !v), []);

  const handleNavigate = useCallback((topicId: string) => {
    if (projectId) {
      navigate(`/project/${projectId}/topic/${topicId}`);
      setExpanded(false);
    }
  }, [projectId, navigate]);

  if (!hasRunning && executions.length === 0) return null;

  return (
    <>
      <button
        onClick={toggle}
        className={`text-sm transition-colors flex items-center gap-1.5 cursor-pointer ${
          hasRunning ? 'text-sky-600 hover:text-sky-700' : 'text-gray-500 hover:text-gray-800'
        }`}
      >
        {hasRunning ? (
          <svg className="w-4 h-4 animate-pulse text-sky-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
          </svg>
        )}
        <span className="hidden sm:inline">
          {hasRunning
            ? `执行中 ${running.length} 条`
            : `最近 ${executions.length} 条`}
        </span>
      </button>

      {expanded && (
        <>
          <div className="fixed inset-0 z-[45]" onClick={() => setExpanded(false)} />
          <div className="absolute right-0 top-14 z-[46] w-[360px] bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
            <div className="max-h-[33vh] overflow-y-auto">
              {running.length > 0 && (
                <div className="p-3 space-y-2">
                  <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">执行中</h4>
                  {running.map((exec) => (
                    <RunningCard
                      key={exec.id}
                      name={exec.topic?.name ?? '未知任务链'}
                      status={exec.status}
                      progress={`${exec.completedTasks}/${exec.totalTasks}`}
                      branch={exec.worktreeBranch}
                      messages={executionMessages[exec.id] ?? []}
                      onStop={() => stopExecution(exec.id)}
                      onExecute={() => startExecution(exec.topicId)}
                      onClick={() => handleNavigate(exec.topicId)}
                    />
                  ))}
                </div>
              )}
              {recent.length > 0 && (
                <div className={`p-3 space-y-2 ${running.length > 0 ? 'border-t border-gray-100' : ''}`}>
                  <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">最近</h4>
                  {recent.slice(0, 5).map((exec) => {
                    const msgs = executionMessages[exec.id] ?? [];
                    const nav = () => handleNavigate(exec.topicId);
                    const execThis = () => startExecution(exec.topicId);
                    return msgs.length > 0 ? (
                      <RunningCard
                        key={exec.id}
                        name={exec.topic?.name ?? '未知任务链'}
                        status={exec.status}
                        progress={`${exec.completedTasks}/${exec.totalTasks}`}
                        branch={exec.worktreeBranch}
                        messages={msgs}
                        onExecute={execThis}
                        onClick={nav}
                      />
                    ) : (
                      <RecentCard
                        key={exec.id}
                        name={exec.topic?.name ?? '未知任务链'}
                        status={exec.status}
                        progress={`${exec.completedTasks}/${exec.totalTasks}`}
                        onExecute={execThis}
                        onClick={nav}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function RunningCard({ name, status, progress, branch, messages, onStop, onExecute, onClick }: {
  name: string;
  status: string;
  progress: string;
  branch: string | null;
  messages: SessionMessage[];
  onStop?: () => void;
  onExecute?: () => void;
  onClick?: () => void;
}) {
  const sl = statusLabel[status] ?? statusLabel.STOPPED;
  const lastMsg = getLastAssistantMsg(messages);
  const summary = extractSummary(lastMsg);
  const isRunning = status === 'RUNNING' || status === 'CREATING_WORKTREE';
  return (
    <div onClick={onClick} className={`rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-2 transition-colors ${onClick ? 'cursor-pointer hover:bg-gray-100' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {isRunning ? (
            <svg className="w-3 h-3 text-sky-500 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <span className={`w-2 h-2 rounded-full shrink-0 ${
              status === 'COMPLETED' ? 'bg-green-500' :
              status === 'STOPPED' ? 'bg-amber-400' :
              status === 'FAILED' ? 'bg-red-500' : 'bg-gray-400'
            }`} />
          )}
          <span className="text-xs font-medium text-gray-800 truncate">{name}</span>
        </div>
        {onStop && isRunning && (
          <button
            onClick={(e) => { e.stopPropagation(); onStop(); }}
            className="shrink-0 text-[10px] text-red-500 hover:text-red-600 px-1.5 py-0.5 rounded border border-red-200 bg-white hover:bg-red-50 transition-colors cursor-pointer"
          >
            停止
          </button>
        )}
        {onExecute && (status === 'STOPPED' || status === 'FAILED') && (
          <button
            onClick={(e) => { e.stopPropagation(); onExecute(); }}
            className="shrink-0 text-[10px] text-sky-600 hover:text-sky-700 px-1.5 py-0.5 rounded border border-sky-200 bg-white hover:bg-sky-50 transition-colors cursor-pointer inline-flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
            </svg>
            执行
          </button>
        )}
        {onClick && status === 'COMPLETED' && (
          <button
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            className="shrink-0 text-[10px] text-sky-600 hover:text-sky-700 px-1.5 py-0.5 rounded border border-sky-200 bg-white hover:bg-sky-50 transition-colors cursor-pointer"
          >
            查看
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 mt-1 pl-5">
        <span className={`text-[10px] font-medium ${sl.color}`}>{sl.text}</span>
        <span className="text-[10px] text-gray-400">{progress}</span>
        {branch && (
          <>
            <span className="text-[10px] text-gray-300">·</span>
            <span className="text-[10px] text-gray-400 font-mono truncate">{branch.replace('opencode/', '')}</span>
          </>
        )}
      </div>
      {(summary || isRunning) && (
        <div className="mt-1.5 pl-5 max-h-[4rem] overflow-hidden">
          {summary ? (
            summary.tool ? (
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${toolStatusIcon[summary.tool.status] ?? 'bg-gray-400'}`} />
                <span className="text-[10px] text-gray-500 truncate">
                  {summary.tool.name}
                  <span className="ml-1 text-gray-400">
                    {summary.tool.status === 'running' ? '运行中' :
                     summary.tool.status === 'completed' ? '完成' :
                     summary.tool.status === 'error' ? '错误' : '等待中'}
                  </span>
                </span>
              </div>
            ) : (
              <p className="text-[10px] text-gray-500 leading-relaxed" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {summary.text}
              </p>
            )
          ) : (
            <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
              <svg className="w-3 h-3 animate-pulse" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              等待 AI 响应...
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RecentCard({ name, status, progress, onClick, onExecute }: {
  name: string;
  status: string;
  progress: string;
  onClick?: () => void;
  onExecute?: () => void;
}) {
  const sl = statusLabel[status] ?? statusLabel.STOPPED;

  return (
    <div onClick={onClick} className={`rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-2 transition-colors ${onClick ? 'cursor-pointer hover:bg-gray-100' : ''}`}>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${
          status === 'COMPLETED' ? 'bg-green-500' :
          status === 'STOPPED' ? 'bg-amber-400' :
          status === 'FAILED' ? 'bg-red-500' : 'bg-gray-400'
        }`} />
        <span className="text-xs font-medium text-gray-800 truncate">{name}</span>
        <span className={`text-[10px] font-medium ${sl.color} ml-auto shrink-0`}>{sl.text}</span>
        <span className="text-[10px] text-gray-400 shrink-0">{progress}</span>
        {onExecute && (status === 'STOPPED' || status === 'FAILED') && (
          <button
            onClick={(e) => { e.stopPropagation(); onExecute(); }}
            className="shrink-0 text-[10px] text-sky-600 hover:text-sky-700 px-1.5 py-0.5 rounded border border-sky-200 bg-white hover:bg-sky-50 transition-colors cursor-pointer inline-flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
            </svg>
            执行
          </button>
        )}
        {onClick && status === 'COMPLETED' && (
          <button
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            className="shrink-0 text-[10px] text-sky-600 hover:text-sky-700 px-1.5 py-0.5 rounded border border-sky-200 bg-white hover:bg-sky-50 transition-colors cursor-pointer"
          >
            查看
          </button>
        )}
      </div>
    </div>
  );
}
