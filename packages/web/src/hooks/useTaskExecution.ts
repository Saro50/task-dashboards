/**
 * 单 topic 任务链执行 hook — 管理执行/停止/合并/恢复的完整生命周期。
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ 完整生命周期：                                                   │
 * │   restoreExecution() → executeChain() → 轮询 → 完成后合并        │
 * │                                                                 │
 * │ 1. restoreExecution  页面加载时按 topicId 恢复执行状态            │
 * │ 2. executeChain      启动执行（后端创建 worktree + AI 会话）      │
 * │ 3. startPolling      每 3s 轮询 getLatest(topicId) 同步状态      │
 * │ 4. cancelExecution   中止执行，IN_PROGRESS 任务重置为 PENDING     │
 * │ 5. mergeExecution    将 worktree 变更 squash merge 到目标分支     │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * 设计决策：为什么用 topicId 而非 projectId 查询执行状态
 *   之前的 ExecutionContext 按 projectId 查询活跃执行，再在 pool 中按 topicId 匹配。
 *   这种方式有两个问题：(1) 按 projectId 查可能漏掉不属于该 project 的执行；
 *   (2) getActiveByProject 的状态过滤（仅 CREATING_WORKTREE/RUNNING/COMPLETED）
 *   导致 STOPPED/FAILED/MERGED 状态的执行不可见，execution 变为 null。
 *   本 hook 直接用 getLatest(topicId) 按 topicId 精确查询，无状态过滤，避免以上问题。
 */
import { useState, useCallback, useRef } from 'react';
import type { Task } from '@/types/task';
import type { TaskExecution } from '@/types/execution';
import { executionApi } from '@/api/execution';
import { useToast } from '@/components/Toast';
import { log } from '@/utils/log';

const S = 'useTaskExecution';

interface UseTaskExecutionOptions {
  topicId: string | undefined;
  projectId: string | undefined;
  onTaskUpdated: () => void;
  /**
   * 项目级最大并发主题数，由全局设置传入。
   * 调用 executionApi.start 时透传给后端，限制同项目下可并行运行的任务链条数。
   */
  maxConcurrency: number;
}

export function useTaskExecution({ topicId, projectId, onTaskUpdated, maxConcurrency }: UseTaskExecutionOptions) {
  const { showToast } = useToast();
  const [executing, setExecuting] = useState(false);
  const [execution, setExecution] = useState<TaskExecution | null>(null);
  const [sessionMessages, setSessionMessages] = useState<any[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback((executionId: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      if (!topicId) return;
      try {
        const latest = await executionApi.getLatest(topicId);
        if (!latest) return;
        setExecution(latest);
        onTaskUpdated();

        if (latest.status === 'RUNNING' && latest.id) {
          executionApi.getMessages(latest.id).then((res) => {
            setSessionMessages(res.messages);
          }).catch(() => {});
        }

        if (latest.status === 'COMPLETED') {
          stopPolling();
          setExecuting(false);
          if (latest.id) {
            executionApi.getMessages(latest.id).then((res) => {
              setSessionMessages(res.messages);
            }).catch(() => {});
          }
          showToast('所有任务已执行完毕', 'success');
        } else if (latest.status === 'FAILED') {
          stopPolling();
          setExecuting(false);
          setSessionMessages([]);
          showToast('执行失败', 'error');
        } else if (latest.status === 'STOPPED') {
          stopPolling();
          setExecuting(false);
          setSessionMessages([]);
        }
      } catch (err: any) {
        log.error(S, 'polling error', err);
      }
    }, 3000);
  }, [topicId, onTaskUpdated, showToast, stopPolling]);

  // _tasks 参数保留但未使用，仅为兼容 TaskGraphPage 的调用签名（传入 filteredTasks）。
  const executeChain = useCallback(
    (_tasks: Task[]) => {
      if (executing) {
        log.warn(S, 'executeChain skipped: already executing');
        return;
      }
      if (!topicId || !projectId) {
        log.warn(S, 'executeChain skipped: missing topicId or projectId');
        return;
      }
      log.info(S, 'executeChain start', { topicId, projectId, maxConcurrency });
      setExecuting(true);

      executionApi.start(topicId, projectId, maxConcurrency)
        .then((exec) => {
          log.info(S, 'execution started', { id: exec.id, status: exec.status });
          setExecution(exec);
          showToast('任务链执行已开始', 'success');
          startPolling(exec.id);
        })
        .catch((err: any) => {
          log.error(S, 'executeChain error', err);
          showToast(err.message, 'error');
          setExecuting(false);
        });
    },
    [executing, topicId, projectId, maxConcurrency, showToast, startPolling],
  );

  const cancelExecution = useCallback(async () => {
    if (!execution) return;
    log.info(S, 'cancelExecution', { executionId: execution.id });
    showToast('正在停止执行...', 'info');
    try {
      const updated = await executionApi.stop(execution.id);
      setExecution(updated);
      setExecuting(false);
      stopPolling();
      onTaskUpdated();
    } catch (err: any) {
      log.error(S, 'cancelExecution error', err);
      showToast(err.message, 'error');
    }
  }, [execution, showToast, stopPolling, onTaskUpdated]);

  /**
   * 合并操作 — 将 worktree 中的代码变更 squash merge 到用户选择的目标分支。
   *
   * 后端执行步骤（见 execution.service.ts::merge）：
   *   1. 在 worktree 目录 git add -A + git commit（opencode 不会自动 commit）
   *   2. 切换到目标分支，执行 git merge --squash worktreeBranch
   *   3. 如有变更则 git commit，无变更则跳过
   *   4. 删除 worktree，将 execution 状态标记为 MERGED
   */
  const mergeExecution = useCallback(async (targetBranch: string) => {
    if (!execution) return;
    log.info(S, 'mergeExecution', { executionId: execution.id, targetBranch });
    try {
      const updated = await executionApi.merge(execution.id, targetBranch);
      setExecution(updated);
      showToast(`已合并到 ${targetBranch}`, 'success');
    } catch (err: any) {
      log.error(S, 'mergeExecution error', err);
      showToast(err.message, 'error');
    }
  }, [execution, showToast]);

  /**
   * 页面加载时恢复执行状态 — 按 topicId 查询最新 execution。
   *
   * 关键：使用 getLatest(topicId) 而非 getActiveByProject(projectId)。
   *   - getLatest 按 topicId 精确查询，无状态过滤，总能找到该 topic 的最新执行
   *   - getActiveByProject 按 projectId + 有限状态过滤，可能漏掉执行导致 execution 为 null
   *
   * 三种恢复路径：
   *   - RUNNING / CREATING_WORKTREE → 恢复轮询，继续跟踪执行进度
   *   - 其他状态（COMPLETED / STOPPED / FAILED / MERGED）→ 仅恢复 execution 值，不启动轮询
   *   - 查无记录 → log.warn 提示（可能是首次访问，尚未执行过任务链）
   */
  const restoreExecution = useCallback(async () => {
    if (!topicId) return;
    try {
      const latest = await executionApi.getLatest(topicId);
      if (!latest) {
        log.warn(S, 'restoreExecution: no execution found for topic', { topicId });
        return;
      }
      if (latest.status === 'RUNNING' || latest.status === 'CREATING_WORKTREE') {
        setExecuting(true);
        setExecution(latest);
        startPolling(latest.id);
      } else {
        setExecution(latest);
        log.info(S, 'restoreExecution: execution restored', {
          topicId,
          status: latest.status,
          executionId: latest.id,
        });
      }
    } catch (err: any) {
      log.error(S, 'restoreExecution error', err);
    }
  }, [topicId, startPolling]);

  return {
    executeChain,
    cancelExecution,
    mergeExecution,
    restoreExecution,
    executing,
    execution,
    sessionMessages,
  };
}
