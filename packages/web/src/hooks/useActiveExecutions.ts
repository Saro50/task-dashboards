/**
 * 全局活跃执行 hook — 供 ExecutionPanel 使用。
 *
 * 获取项目下的执行列表，并为 RUNNING 状态的执行拉取 session messages。
 * 每个步骤图谱页面（StepGraphPage）使用 useTaskExecution hook 管理
 * 单个 task 的执行生命周期，与本 hook 通过 executionEvents 总线互相同步：
 *   - 本 hook 内用户动作（stop/start）成功后 emit 事件，StepGraphPage 收到后立即 restoreExecution
 *   - 订阅事件，StepGraphPage 内的 cancelExecution/executeChain/mergeExecution 触发后立即 refresh
 *   - 轮询被动检测到的状态变化不发事件（避免循环刷新），靠各自轮询同步
 *
 * 同时拉取项目下全量 tasks（含 aggregatedStatus），计算 pendingTasks：
 *   - aggregatedStatus !== 'COMPLETED'（步骤未全部完成）
 *   - 且当前没有 RUNNING/CREATING_WORKTREE 的 execution（未在跑）
 * 供 ExecutionPanel 顶部"一键执行"按钮使用。
 *
 * 上下游影响：startAllPending 内部循环调用 executionApi.start，
 * 后端按 maxConcurrency 强制并发上限（超出的 429 被 hook 静默吃掉），
 * emitExecutionEvent 通知 StepGraphPage 各自刷新。
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import type { TaskExecution } from '@/types/execution';
import type { SessionMessage } from '@/types/session-message';
import type { Task } from '@/types/task';
import { executionApi } from '@/api/execution';
import { taskApi } from '@/api/task';
import { log } from '@/utils/log';
import { emitExecutionEvent, onExecutionEvent } from '@/utils/executionEvents';

const S = 'useActiveExecutions';
const POLL_INTERVAL = 5000;

export function useActiveExecutions(projectId: string | undefined, maxConcurrency: number) {
  const [executions, setExecutions] = useState<TaskExecution[]>([]);
  const [executionMessages, setExecutionMessages] = useState<Record<string, SessionMessage[]>>({});
  const [tasks, setTasks] = useState<Task[]>([]);
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

  // 拉取项目下全量任务（含 aggregatedStatus），用于计算 pendingTasks。
  // 与 refresh 同生命周期：执行启动/停止后任务状态会变，需要同步刷新。
  const refreshTasks = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await taskApi.list(projectId);
      setTasks(data.tasks);
    } catch (err: any) {
      log.error(S, 'refreshTasks error', err);
    }
  }, [projectId]);

  useEffect(() => {
    // 切换到无 projectId 的页面（如项目管理页 /）时：清空残留 state，不启动轮询。
    // 否则从 /project/A 返回 / 时 executions/tasks 仍保留 A 的数据，面板会错误显示。
    if (!projectId) {
      setExecutions([]);
      setExecutionMessages({});
      setTasks([]);
      return;
    }
    refresh();
    refreshTasks();
    timerRef.current = setInterval(refresh, POLL_INTERVAL);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [projectId, refresh, refreshTasks]);

  // 订阅事件总线：StepGraphPage 内的动作触发后立即 refresh，避免 5s 轮询延迟
  useEffect(() => {
    return onExecutionEvent((event) => {
      log.info(S, 'event received, refreshing', { type: event.type, executionId: event.executionId });
      refresh();
      refreshTasks();
    });
  }, [refresh, refreshTasks]);

  const hasRunning = executions.some(
    (e) => e.status === 'RUNNING' || e.status === 'CREATING_WORKTREE',
  );

  // pendingTasks：未完成且未在跑的任务，供 ExecutionPanel"一键执行"按钮使用。
  // 排除以下三种状态的任务：
  //   RUNNING / CREATING_WORKTREE → 已在跑，不能重复启动（后端会 409）
  //   COMPLETED                    → 待合并，再启动无意义（步骤已全部跑完）
  // STOPPED 不排除：用户主动停的也允许一键重启。
  // FAILED 不在 getActiveByProject 返回里（后端只返 4 种 active 状态），不会被错误包含。
  const blockingTaskIds = new Set(
    executions
      .filter((e) =>
        e.status === 'RUNNING' ||
        e.status === 'CREATING_WORKTREE' ||
        e.status === 'COMPLETED',
      )
      .map((e) => e.taskId),
  );
  const pendingTasks = tasks.filter(
    (t) => t.aggregatedStatus !== 'COMPLETED' && !blockingTaskIds.has(t.id),
  );

  const stopExecution = useCallback(async (executionId: string) => {
    let stoppedTaskId: string | undefined;
    try {
      const exec = await executionApi.stop(executionId);
      stoppedTaskId = exec.taskId;
    } catch (err: any) {
      if (!err.message?.includes('not running')) {
        log.error(S, 'stopExecution error', err);
      }
    }
    // 仅在确实停止成功时 emit；失败时不发，避免触发无意义的全量刷新
    if (stoppedTaskId) {
      emitExecutionEvent({ type: 'stopped', executionId, topicId: stoppedTaskId });
    }
    refresh();
    refreshTasks();
  }, [refresh, refreshTasks]);

  const startExecution = useCallback(async (taskId: string) => {
    if (!projectId) return;
    let startedExecId: string | undefined;
    try {
      const exec = await executionApi.start(taskId, projectId, maxConcurrency);
      startedExecId = exec.id;
    } catch (err: any) {
      log.error(S, 'startExecution error', err);
    }
    if (startedExecId) {
      emitExecutionEvent({ type: 'started', executionId: startedExecId, topicId: taskId });
    }
    refresh();
    refreshTasks();
  }, [projectId, maxConcurrency, refresh, refreshTasks]);

  /**
   * 批量启动所有 pendingTasks。
   *
   * 上下游影响：
   * - 顺序调用 executionApi.start（不并发，避免突发压力；后端会按 maxConcurrency 拦截 429）
   * - 409 "already running" / 429 "最大并发" 视为正常情况，计入 skipped 不抛错
   * - 其它错误计入 skipped 但记日志，便于排查
   * - 每次成功 emit 事件，让 StepGraphPage 各自同步状态
   */
  const startAllPending = useCallback(async (): Promise<{ started: number; skipped: number }> => {
    if (!projectId) return { started: 0, skipped: 0 };
    let started = 0;
    let skipped = 0;
    for (const task of pendingTasks) {
      try {
        const exec = await executionApi.start(task.id, projectId, maxConcurrency);
        started++;
        emitExecutionEvent({ type: 'started', executionId: exec.id, topicId: task.id });
      } catch (err: any) {
        const msg = err.message || '';
        if (msg.includes('already running') || msg.includes('最大并发')) {
          skipped++;
          continue;
        }
        log.error(S, 'startAllPending error', { taskId: task.id, error: msg });
        skipped++;
      }
    }
    refresh();
    refreshTasks();
    return { started, skipped };
  }, [pendingTasks, projectId, maxConcurrency, refresh, refreshTasks]);

  return { executions, executionMessages, hasRunning, stopExecution, startExecution, pendingTasks, startAllPending };
}
