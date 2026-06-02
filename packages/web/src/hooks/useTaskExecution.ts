/**
 * 任务链执行 hook。
 *
 * 重构说明：之前的实现是纯前端模拟（setTimeout 随机延迟标记完成），
 * 不涉及真正的 AI 执行。现在改为基于后端 TaskExecution 模型的真实执行流程：
 *   1. executeChain → 调用后端 API 启动执行（后端创建 worktree + AI 会话）
 *   2. startPolling → 每 3 秒轮询执行状态，同步前端状态
 *   3. 完成后由 TaskGraphPage 弹出 MergeDialog 让用户选择目标分支
 *   4. restoreExecution → 页面加载时恢复未完成的执行（刷新不丢失）
 *
 * 新增 projectId 参数是因为后端需要它来查找项目的本地路径，用于 worktree 和会话创建。
 */
import { useState, useCallback, useRef } from 'react';
import type { Task } from '@/types/task';
import type { TaskExecution, ExecutionStatus } from '@/types/execution';
import { executionApi } from '@/api/execution';
import { useToast } from '@/components/Toast';
import { log } from '@/utils/log';

const S = 'useTaskExecution';

interface UseTaskExecutionOptions {
  topicId: string | undefined;
  projectId: string | undefined;
  onTaskUpdated: () => void;
}

export function useTaskExecution({ topicId, projectId, onTaskUpdated }: UseTaskExecutionOptions) {
  const { showToast } = useToast();
  const [executing, setExecuting] = useState(false);
  const [execution, setExecution] = useState<TaskExecution | null>(null);
  const [maxConcurrency, setMaxConcurrency] = useState(2);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // 每 3 秒轮询后端获取最新执行状态。
  // 为什么用轮询而不是 SSE：执行是长时间运行的后台任务（几分钟到几十分钟），
  // 轮询开销极小且实现简单，不需要维护 WebSocket/SSE 连接的断线重连逻辑。
  const startPolling = useCallback((executionId: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      if (!topicId) return;
      try {
        const latest = await executionApi.getLatest(topicId);
        if (!latest) return;
        setExecution(latest);
        onTaskUpdated();

        if (latest.status === 'COMPLETED') {
          stopPolling();
          setExecuting(false);
          showToast('所有任务已执行完毕', 'success');
        } else if (latest.status === 'FAILED') {
          stopPolling();
          setExecuting(false);
          showToast('执行失败', 'error');
        } else if (latest.status === 'STOPPED') {
          stopPolling();
          setExecuting(false);
        }
      } catch (err: any) {
        log.error(S, 'polling error', err);
      }
    }, 3000);
  }, [topicId, onTaskUpdated, showToast, stopPolling]);

  // _tasks 参数保留但未使用，仅为兼容 TaskGraphPage 的调用签名（传入 filteredTasks）。
  // 实际要执行哪些任务由后端从 DB 读取，前端无需传递。
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

  // 合并操作：用户在 MergeDialog 中选择目标分支后调用。
  // 后端目前仅记录 targetBranch 并将状态标记为 MERGED，实际的 git merge
  // 需要后续集成 git 操作 API 来完成。
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

  // 页面加载时恢复未完成的执行状态。
  // 为什么需要这个：用户可能在执行过程中刷新页面或关闭后重新打开，
  // 此时后端仍在执行任务。通过 restoreExecution 恢复轮询，
  // 确保前端状态与后端同步，不会出现"看起来没在执行但实际在跑"的情况。
  const restoreExecution = useCallback(async () => {
    if (!topicId) return;
    try {
      const latest = await executionApi.getLatest(topicId);
      if (latest && (latest.status === 'RUNNING' || latest.status === 'CREATING_WORKTREE')) {
        setExecuting(true);
        setExecution(latest);
        startPolling(latest.id);
      } else if (latest) {
        setExecution(latest);
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
    maxConcurrency,
    setMaxConcurrency,
  };
}
