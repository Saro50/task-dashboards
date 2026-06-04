/**
 * 全局执行面板 — 在导航栏中显示当前项目的活跃执行。
 *
 * 数据来源：useActiveExecutions hook，按 projectId 轮询获取活跃执行列表。
 * 不再依赖已删除的 ExecutionContext（pool 机制）。
 */
import { useState, useCallback } from 'react';
import { useParams } from 'react-router';
import { useActiveExecutions } from '@/hooks/useActiveExecutions';

export default function ExecutionPanel() {
  const { projectId } = useParams<{ projectId: string }>();
  const { executions, hasRunning, stopExecution } = useActiveExecutions(projectId);
  const [expanded, setExpanded] = useState(false);

  const running = executions.filter(
    (e) => e.status === 'RUNNING' || e.status === 'CREATING_WORKTREE',
  );
  const recent = executions.filter(
    (e) => e.status === 'COMPLETED' || e.status === 'FAILED' || e.status === 'STOPPED',
  );

  const toggle = useCallback(() => setExpanded((v) => !v), []);

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
          <div className="absolute left-0 right-0 top-14 z-[46] bg-white border-b border-gray-200 shadow-lg animate-[slideInRight_0.2s_ease_both]">
            <div className="max-h-[300px] overflow-y-auto">
              {running.length > 0 && (
                <div className="px-4 py-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-gray-800">执行中</h4>
                  </div>
                  {running.map((exec) => (
                    <ExecutionCard
                      key={exec.id}
                      execution={exec}
                      onStop={stopExecution}
                    />
                  ))}
                </div>
              )}
              {recent.length > 0 && (
                <div className="px-4 py-3 space-y-2 border-t border-gray-100">
                  <h4 className="text-xs font-medium text-gray-500">最近</h4>
                  {recent.slice(0, 3).map((exec) => (
                    <ExecutionCard
                      key={exec.id}
                      execution={exec}
                      onStop={stopExecution}
                      compact
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function ExecutionCard({ execution, onStop, compact }: {
  execution: { id: string; status: string; completedTasks: number; totalTasks: number; worktreeBranch: string | null };
  onStop: (id: string) => void;
  compact?: boolean;
}) {
  const isRunning = execution.status === 'RUNNING' || execution.status === 'CREATING_WORKTREE';

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <div className="flex items-center gap-2 min-w-0">
          {isRunning ? (
            <svg className="w-3.5 h-3.5 text-sky-500 shrink-0 animate-pulse" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              execution.status === 'COMPLETED' ? 'bg-green-500' :
              execution.status === 'FAILED' ? 'bg-red-500' : 'bg-gray-400'
            }`} />
          )}
          <span className="text-xs font-medium text-gray-700 truncate">
            {execution.status === 'CREATING_WORKTREE' ? '创建 worktree...' :
             `${execution.completedTasks}/${execution.totalTasks}`}
          </span>
          {execution.worktreeBranch && (
            <span className="text-[10px] text-gray-400 font-mono truncate">{execution.worktreeBranch}</span>
          )}
        </div>
        {isRunning && (
          <button
            onClick={() => onStop(execution.id)}
            className="shrink-0 inline-flex items-center gap-1 text-[10px] text-red-500 hover:text-red-600 px-2 py-0.5 rounded border border-red-200 bg-white hover:bg-red-50 transition-colors cursor-pointer"
          >
            停止
          </button>
        )}
      </div>
    </div>
  );
}
