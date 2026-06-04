/**
 * 全局活跃执行 hook — 供 ExecutionPanel 使用。
 *
 * 获取项目下的执行列表，并为 RUNNING 状态的执行拉取 session messages。
 * 每个任务图谱页面（TaskGraphPage）使用 useTaskExecution hook 管理
 * 单个 topic 的执行生命周期，与本 hook 互不干扰。
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import type { TaskExecution } from '@/types/execution';
import type { SessionMessage } from '@/types/session-message';
import { executionApi } from '@/api/execution';
import { log } from '@/utils/log';

const S = 'useActiveExecutions';
const POLL_INTERVAL = 5000;

export function useActiveExecutions(projectId: string | undefined) {
  const [executions, setExecutions] = useState<TaskExecution[]>([]);
  const [executionMessages, setExecutionMessages] = useState<Record<string, SessionMessage[]>>({});
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    try {
      const active = await executionApi.getActive(projectId);
      if (active.length === 0) {
        log.warn(S, 'no active executions found for project', { projectId });
      }
      setExecutions(active);

      const withMessages = active.filter(
        (e) => e.status === 'RUNNING' || e.status === 'STOPPED',
      );
      for (const exec of withMessages) {
        executionApi.getMessages(exec.id).then((res) => {
          const msgs = (res as any).messages ?? res;
          log.info(S, 'messages fetched', { executionId: exec.id, count: Array.isArray(msgs) ? msgs.length : 0 });
          setExecutionMessages((prev) => ({ ...prev, [exec.id]: msgs }));
        }).catch((err) => {
          log.error(S, 'getMessages failed', { executionId: exec.id, error: err.message });
        });
      }
    } catch (err: any) {
      log.error(S, 'refresh error', err);
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
    timerRef.current = setInterval(refresh, POLL_INTERVAL);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [refresh]);

  const hasRunning = executions.some(
    (e) => e.status === 'RUNNING' || e.status === 'CREATING_WORKTREE',
  );

  const stopExecution = useCallback(async (executionId: string) => {
    try {
      await executionApi.stop(executionId);
    } catch (err: any) {
      if (!err.message?.includes('not running')) {
        log.error(S, 'stopExecution error', err);
      }
    }
    refresh();
  }, [refresh]);

  return { executions, executionMessages, hasRunning, stopExecution };
}
