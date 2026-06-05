/**
 * 全局活跃执行 hook — 供 ExecutionPanel 使用。
 *
 * 获取项目下的执行列表，并为 RUNNING 状态的执行拉取 session messages。
 * 每个任务图谱页面（TaskGraphPage）使用 useTaskExecution hook 管理
 * 单个 topic 的执行生命周期，与本 hook 通过 executionEvents 总线互相同步：
 *   - 本 hook 内用户动作（stop/start）成功后 emit 事件，TaskGraphPage 收到后立即 restoreExecution
 *   - 订阅事件，TaskGraphPage 内的 cancelExecution/executeChain/mergeExecution 触发后立即 refresh
 *   - 轮询被动检测到的状态变化不发事件（避免循环刷新），靠各自轮询同步
 *
 * 同时拉取项目下全量 topics（含 aggregatedStatus），计算 pendingTopics：
 *   - aggregatedStatus !== 'COMPLETED'（任务未全部完成）
 *   - 且当前没有 RUNNING/CREATING_WORKTREE 的 execution（未在跑）
 * 供 ExecutionPanel 顶部"一键执行"按钮使用。
 *
 * 上下游影响：startAllPending 内部循环调用 executionApi.start，
 * 后端按 maxConcurrency 强制并发上限（超出的 429 被 hook 静默吃掉），
 * emitExecutionEvent 通知 TaskGraphPage 各自刷新。
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import type { TaskExecution } from '@/types/execution';
import type { SessionMessage } from '@/types/session-message';
import type { TaskTopic } from '@/types/topic';
import { executionApi } from '@/api/execution';
import { topicApi } from '@/api/topic';
import { log } from '@/utils/log';
import { emitExecutionEvent, onExecutionEvent } from '@/utils/executionEvents';

const S = 'useActiveExecutions';
const POLL_INTERVAL = 5000;

export function useActiveExecutions(projectId: string | undefined, maxConcurrency: number) {
  const [executions, setExecutions] = useState<TaskExecution[]>([]);
  const [executionMessages, setExecutionMessages] = useState<Record<string, SessionMessage[]>>({});
  const [topics, setTopics] = useState<TaskTopic[]>([]);
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

  // 拉取项目下全量主题（含 aggregatedStatus），用于计算 pendingTopics。
  // 与 refresh 同生命周期：执行启动/停止后主题状态会变，需要同步刷新。
  const refreshTopics = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await topicApi.list(projectId);
      setTopics(data.topics);
    } catch (err: any) {
      log.error(S, 'refreshTopics error', err);
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
    refreshTopics();
    timerRef.current = setInterval(refresh, POLL_INTERVAL);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [refresh, refreshTopics]);

  // 订阅事件总线：TaskGraphPage 内的动作触发后立即 refresh，避免 5s 轮询延迟
  useEffect(() => {
    return onExecutionEvent((event) => {
      log.info(S, 'event received, refreshing', { type: event.type, executionId: event.executionId });
      refresh();
      refreshTopics();
    });
  }, [refresh, refreshTopics]);

  const hasRunning = executions.some(
    (e) => e.status === 'RUNNING' || e.status === 'CREATING_WORKTREE',
  );

  // pendingTopics：未完成且未在跑的主题，供 ExecutionPanel"一键执行"按钮使用。
  // 排除以下三种状态的主题：
  //   RUNNING / CREATING_WORKTREE → 已在跑，不能重复启动（后端会 409）
  //   COMPLETED                    → 待合并，再启动无意义（任务已全部跑完）
  // STOPPED 不排除：用户主动停的也允许一键重启。
  // FAILED 不在 getActiveByProject 返回里（后端只返 4 种 active 状态），不会被错误包含。
  const blockingTopicIds = new Set(
    executions
      .filter((e) =>
        e.status === 'RUNNING' ||
        e.status === 'CREATING_WORKTREE' ||
        e.status === 'COMPLETED',
      )
      .map((e) => e.topicId),
  );
  const pendingTopics = topics.filter(
    (t) => t.aggregatedStatus !== 'COMPLETED' && !blockingTopicIds.has(t.id),
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
    refreshTopics();
  }, [refresh, refreshTopics]);

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
    refreshTopics();
  }, [projectId, maxConcurrency, refresh, refreshTopics]);

  /**
   * 批量启动所有 pendingTopics。
   *
   * 上下游影响：
   * - 顺序调用 executionApi.start（不并发，避免突发压力；后端会按 maxConcurrency 拦截 429）
   * - 409 "already running" / 429 "最大并发" 视为正常情况，计入 skipped 不抛错
   * - 其它错误计入 skipped 但记日志，便于排查
   * - 每次成功 emit 事件，让 TaskGraphPage 各自同步状态
   */
  const startAllPending = useCallback(async (): Promise<{ started: number; skipped: number }> => {
    if (!projectId) return { started: 0, skipped: 0 };
    let started = 0;
    let skipped = 0;
    for (const topic of pendingTopics) {
      try {
        const exec = await executionApi.start(topic.id, projectId, maxConcurrency);
        started++;
        emitExecutionEvent({ type: 'started', executionId: exec.id, topicId: topic.id });
      } catch (err: any) {
        const msg = err.message || '';
        if (msg.includes('already running') || msg.includes('最大并发')) {
          skipped++;
          continue;
        }
        log.error(S, 'startAllPending error', { topicId: topic.id, error: msg });
        skipped++;
      }
    }
    refresh();
    refreshTopics();
    return { started, skipped };
  }, [pendingTopics, projectId, maxConcurrency, refresh, refreshTopics]);

  return { executions, executionMessages, hasRunning, stopExecution, startExecution, pendingTopics, startAllPending };
}
