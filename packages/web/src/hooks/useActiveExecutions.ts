/**
 * 全局活跃执行 hook — 供 ExecutionPanel 使用。
 *
 * 设计说明：
 *   之前的 ExecutionContext 维护了一个全局 pool，通过 restoreForProject(projectId)
 *   按 projectId 查询活跃执行。但该方案有两个问题：
 *   1. 查询维度是 projectId 而非 topicId，需要额外的 topicId 匹配才能定位到具体执行
 *   2. 状态过滤仅包含 CREATING_WORKTREE / RUNNING / COMPLETED，导致已停止或失败的执行不可见
 *
 *   本 hook 简化了设计：接收 projectId，直接调用 getActiveByProject API 获取该项目的
 *   活跃执行列表，以固定间隔轮询刷新。不再维护复杂的 pool/ref 机制。
 *
 *   每个任务图谱页面（TaskGraphPage）使用 useTaskExecution hook 管理
 *   单个 topic 的执行生命周期（启动/停止/合并/恢复），与本 hook 互不干扰。
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import type { TaskExecution } from '@/types/execution';
import { executionApi } from '@/api/execution';
import { log } from '@/utils/log';

const S = 'useActiveExecutions';

const POLL_INTERVAL = 5000;

export function useActiveExecutions(projectId: string | undefined) {
  const [executions, setExecutions] = useState<TaskExecution[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await executionApi.getActive(projectId);
      const active = res.data || [];
      if (active.length === 0) {
        log.warn(S, 'no active executions found for project', { projectId });
      }
      setExecutions(active);
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
      refresh();
    } catch (err: any) {
      log.error(S, 'stopExecution error', err);
    }
  }, [refresh]);

  return { executions, hasRunning, stopExecution };
}
