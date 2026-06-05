/**
 * 全局活跃执行 hook — 供 ExecutionPanel 使用。
 *
 * 获取项目下的执行列表，并为 RUNNING 状态的执行拉取 session messages。
 * 每个任务图谱页面（TaskGraphPage）使用 useTaskExecution hook 管理
 * 单个 topic 的执行生命周期，与本 hook 通过 executionEvents 总线互相同步：
 *   - 本 hook 内用户动作（stop/start）成功后 emit 事件，TaskGraphPage 收到后立即 restoreExecution
 *   - 订阅事件，TaskGraphPage 内的 cancelExecution/executeChain/mergeExecution 触发后立即 refresh
 *   - 轮询被动检测到的状态变化不发事件（避免循环刷新），靠各自轮询同步
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import type { TaskExecution } from '@/types/execution';
import type { SessionMessage } from '@/types/session-message';
import { executionApi } from '@/api/execution';
import { log } from '@/utils/log';
import { emitExecutionEvent, onExecutionEvent } from '@/utils/executionEvents';

const S = 'useActiveExecutions';
const POLL_INTERVAL = 5000;

export function useActiveExecutions(projectId: string | undefined, maxConcurrency: number) {
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
          const arr = Array.isArray(msgs) ? msgs : [];
          log.info(S, 'messages fetched', { executionId: exec.id, count: arr.length, sample: arr[0]?.type });
          setExecutionMessages((prev) => ({ ...prev, [exec.id]: arr }));
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

  // 订阅事件总线：TaskGraphPage 内的动作触发后立即 refresh，避免 5s 轮询延迟
  useEffect(() => {
    return onExecutionEvent((event) => {
      log.info(S, 'event received, refreshing', { type: event.type, executionId: event.executionId });
      refresh();
    });
  }, [refresh]);

  const hasRunning = executions.some(
    (e) => e.status === 'RUNNING' || e.status === 'CREATING_WORKTREE',
  );

  const stopExecution = useCallback(async (executionId: string) => {
    let stoppedTopicId: string | undefined;
    try {
      const exec = await executionApi.stop(executionId);
      stoppedTopicId = exec.topicId;
    } catch (err: any) {
      if (!err.message?.includes('not running')) {
        log.error(S, 'stopExecution error', err);
      }
    }
    // 仅在确实停止成功时 emit；失败时不发，避免触发无意义的全量刷新
    if (stoppedTopicId) {
      emitExecutionEvent({ type: 'stopped', executionId, topicId: stoppedTopicId });
    }
    refresh();
  }, [refresh]);

  const startExecution = useCallback(async (topicId: string) => {
    if (!projectId) return;
    let startedExecId: string | undefined;
    try {
      const exec = await executionApi.start(topicId, projectId, maxConcurrency);
      startedExecId = exec.id;
    } catch (err: any) {
      log.error(S, 'startExecution error', err);
    }
    if (startedExecId) {
      emitExecutionEvent({ type: 'started', executionId: startedExecId, topicId });
    }
    refresh();
  }, [projectId, maxConcurrency, refresh]);

  return { executions, executionMessages, hasRunning, stopExecution, startExecution };
}
