import { useState, useEffect, useCallback, useRef } from 'react';
import type { TaskTopic, TopicDependency, TopicsResponse } from '@/types/topic';
import type { Task } from '@/types/task';
import { topicApi } from '@/api/topic';
import { log } from '@/utils/log';
import { onExecutionEvent } from '@/utils/executionEvents';

const S = 'useTopics';
const POLL_INTERVAL = 5000;
// 启动宽限期：覆盖 CREATING_WORKTREE（worktree + session 创建）期间 aggregatedStatus 仍为 PENDING 的空窗。
// 若纯粹按 IN_PROGRESS 门控轮询，启动后首个 tick 看不到 IN_PROGRESS → 停止轮询 → 永远感知不到翻转（死锁）。
// 宽限期内无视 IN_PROGRESS 保持轮询，待任务真正进入 IN_PROGRESS 后由该条件接管。
const START_GRACE_MS = 90_000;

/**
 * 项目主题列表 hook — 供 TopicGraphPage / TaskGraphPage 使用。
 *
 * 数据刷新策略（仅「执行中」才轮询，避免空闲时无谓请求）：
 *   - 挂载 / projectId 变化：非静默拉取一次（带 loading）。
 *   - 每次 fetch 后按数据自管理轮询：
 *       hasInProgress（存在 IN_PROGRESS 主题）|| inGrace（启动宽限期内）→ 保持轮询；
 *       否则停止轮询。
 *   - 订阅执行事件总线：started 重置宽限并即时刷新；stopped/merged 清零宽限（下个 tick 自动停轮询）。
 *   - 轮询 / 事件触发的刷新为「静默」(silent)，不触发 loading，避免每 5s 闪全屏转圈。
 *
 * 上下游影响：
 *   - refetch（手动改名/删除/导入等）仍走非静默，行为与历史一致（带 loading）。
 *   - 轮询自管理内部使用 timerRef + fetchDataRef，不依赖 topics 闭包，避免状态过期。
 */
export function useTopics(projectId: string | undefined) {
  const [topics, setTopics] = useState<TaskTopic[]>([]);
  const [dependencies, setDependencies] = useState<TopicDependency[]>([]);
  const [orphanTasks, setOrphanTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);
  // 持有最新 fetchData，供 setInterval 回调调用，避免闭包过期（projectId 变化时 fetchData 重建）。
  const fetchDataRef = useRef<(silent?: boolean) => Promise<void>>(async () => {});

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const ensurePolling = useCallback(() => {
    if (timerRef.current) return; // 已在轮询，避免重复 setInterval
    timerRef.current = setInterval(() => {
      void fetchDataRef.current(true);
    }, POLL_INTERVAL);
  }, []);

  const fetchData = useCallback(async (silent = false) => {
    if (!projectId) {
      log.warn(S, 'fetchData skipped: no projectId');
      return;
    }
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data: TopicsResponse = await topicApi.list(projectId);
      setTopics(data.topics);
      setDependencies(data.dependencies);
      setOrphanTasks(data.orphanTasks);
      log.info(S, 'fetchData success', { projectId, silent, count: data.topics.length });

      // 轮询自管理：仅在「有任务执行中」或「启动宽限期内」保持轮询，否则停止。
      const hasInProgress = data.topics.some((t) => t.aggregatedStatus === 'IN_PROGRESS');
      const inGrace = Date.now() - startedAtRef.current < START_GRACE_MS;
      if (hasInProgress || inGrace) {
        ensurePolling();
      } else {
        stopPolling();
      }
    } catch (err: any) {
      log.error(S, 'fetchData error', err);
      setError(err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [projectId, ensurePolling, stopPolling]);

  // 保持 fetchDataRef 指向最新 fetchData
  useEffect(() => {
    fetchDataRef.current = fetchData;
  }, [fetchData]);

  // 挂载 / projectId 变化：首次拉取（非静默）；切换项目时清空宽限，卸载时停止轮询。
  useEffect(() => {
    stopPolling();
    startedAtRef.current = 0;
    void fetchData();
    return () => {
      stopPolling();
    };
  }, [fetchData, stopPolling]);

  // 订阅执行事件：started 重置宽限（桥接 worktree 创建空窗）；stopped/merged 清零宽限（下个 tick 自动停）。
  useEffect(() => {
    return onExecutionEvent((e) => {
      startedAtRef.current = e.type === 'started' ? Date.now() : 0;
      void fetchData(true);
    });
  }, [fetchData]);

  // 手动 refetch（非静默，带 loading），保持稳定引用
  const refetch = useCallback(() => fetchData(), [fetchData]);

  return { topics, dependencies, orphanTasks, loading, error, refetch };
}
