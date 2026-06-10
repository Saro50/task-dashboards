/**
 * 单 task 任务链执行 hook — 管理执行/停止/合并/恢复的完整生命周期。
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ 完整生命周期：                                                   │
 * │   restoreExecution() → executeChain() → 轮询 → 完成后合并        │
 * │                                                                 │
 * │ 1. restoreExecution  页面加载时按 taskId 恢复执行状态             │
 * │ 2. executeChain      启动执行（后端创建 worktree + AI 会话）      │
 * │ 3. startPolling      每 3s 轮询 getLatest(taskId) 同步状态       │
 * │ 4. cancelExecution   中止执行，IN_PROGRESS 步骤重置为 PENDING     │
 * │ 5. mergeExecution    将 worktree 变更 squash merge 到目标分支     │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * 设计决策：为什么用 taskId 而非 projectId 查询执行状态
 *   之前的 ExecutionContext 按 projectId 查询活跃执行，再在 pool 中按 taskId 匹配。
 *   这种方式有两个问题：(1) 按 projectId 查可能漏掉不属于该 project 的执行；
 *   (2) getActiveByProject 的状态过滤（仅 CREATING_WORKTREE/RUNNING/COMPLETED）
 *   导致 STOPPED/FAILED/MERGED 状态的执行不可见，execution 变为 null。
 *   本 hook 直接用 getLatest(taskId) 按 taskId 精确查询，无状态过滤，避免以上问题。
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import type { Step } from '@/types/step';
import type { TaskExecution } from '@/types/execution';
import { executionApi } from '@/api/execution';
import { useToast } from '@/components/Toast';
import { log } from '@/utils/log';
import { emitExecutionEvent, onExecutionEvent } from '@/utils/executionEvents';

const S = 'useTaskExecution';

interface UseTaskExecutionOptions {
  taskId: string | undefined;
  projectId: string | undefined;
  onStepUpdated: () => void;
  /**
   * 项目级最大并发任务数，由全局设置传入。
   * 调用 executionApi.start 时透传给后端，限制同项目下可并行运行的任务链条数。
   */
  maxConcurrency: number;
}

export function useTaskExecution({ taskId, projectId, onStepUpdated, maxConcurrency }: UseTaskExecutionOptions) {
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
      if (!taskId) return;
      try {
        const latest = await executionApi.getLatest(taskId);
        if (!latest) return;
        setExecution(latest);
        onStepUpdated();

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
          showToast('所有步骤已执行完毕', 'success');
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
  }, [taskId, onStepUpdated, showToast, stopPolling]);

  // _steps 参数保留但未使用，仅为兼容 StepGraphPage 的调用签名（传入 filteredSteps）。
  const executeChain = useCallback(
    (_steps: Step[]) => {
      if (executing) {
        log.warn(S, 'executeChain skipped: already executing');
        return;
      }
      if (!taskId || !projectId) {
        log.warn(S, 'executeChain skipped: missing taskId or projectId');
        return;
      }
      log.info(S, 'executeChain start', { taskId, projectId, maxConcurrency });
      setExecuting(true);

      executionApi.start(taskId, projectId, maxConcurrency)
        .then((exec) => {
          log.info(S, 'execution started', { id: exec.id, status: exec.status });
          setExecution(exec);
          showToast('任务链执行已开始', 'success');
          startPolling(exec.id);
          // 通知 ExecutionPanel 立即刷新（避免 5s 轮询延迟）
          emitExecutionEvent({ type: 'started', executionId: exec.id, topicId: taskId });
        })
        .catch((err: any) => {
          log.error(S, 'executeChain error', err);
          showToast(err.message, 'error');
          setExecuting(false);
        });
    },
    [executing, taskId, projectId, maxConcurrency, showToast, startPolling],
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
      onStepUpdated();
      // 通知 ExecutionPanel 立即把卡片移到"最近"区
      emitExecutionEvent({ type: 'stopped', executionId: execution.id, topicId: execution.taskId });
    } catch (err: any) {
      log.error(S, 'cancelExecution error', err);
      showToast(err.message, 'error');
    }
  }, [execution, showToast, stopPolling, onStepUpdated]);

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
      // 通知 ExecutionPanel：MERGED 状态不在面板显示，触发后卡片会从列表移除
      emitExecutionEvent({ type: 'merged', executionId: execution.id, topicId: execution.taskId });
    } catch (err: any) {
      log.error(S, 'mergeExecution error', err);
      showToast(err.message, 'error');
    }
  }, [execution, showToast]);

  /**
   * 页面加载时恢复执行状态 — 按 taskId 查询最新 execution。
   *
   * 关键：使用 getLatest(taskId) 而非 getActiveByProject(projectId)。
   *   - getLatest 按 taskId 精确查询，无状态过滤，总能找到该 task 的最新执行
   *   - getActiveByProject 按 projectId + 有限状态过滤，可能漏掉执行导致 execution 为 null
   *
   * 三种恢复路径：
   *   - RUNNING / CREATING_WORKTREE → 恢复轮询，继续跟踪执行进度
   *   - 其他状态（COMPLETED / STOPPED / FAILED / MERGED）→ 仅恢复 execution 值，不启动轮询
   *   - 查无记录 → log.warn 提示（可能是首次访问，尚未执行过任务链）
   */
  const restoreExecution = useCallback(async () => {
    if (!taskId) return;
    try {
      const latest = await executionApi.getLatest(taskId);
      if (!latest) {
        log.warn(S, 'restoreExecution: no execution found for task', { taskId });
        return;
      }
      if (latest.status === 'RUNNING' || latest.status === 'CREATING_WORKTREE') {
        setExecuting(true);
        setExecution(latest);
        startPolling(latest.id);
      } else {
        setExecution(latest);
        log.info(S, 'restoreExecution: execution restored', {
          taskId,
          status: latest.status,
          executionId: latest.id,
        });
      }
    } catch (err: any) {
      log.error(S, 'restoreExecution error', err);
    }
  }, [taskId, startPolling]);

  /**
   * 订阅事件总线：当 ExecutionPanel（或其他位置）对该 task 发起 stop/start/merge 时，
   * 立即调用 restoreExecution 同步本地状态。
   *
   * 关键场景：本 hook 在检测到 STOPPED 后会 stopPolling()，此时若用户在面板里点了"执行"
   * 重新启动一条 execution，本 hook 没有事件订阅就会永远感知不到，面包屑按钮卡在
   * "执行任务链"可点击状态。订阅事件后 restoreExecution 会检测到新的 RUNNING 状态
   * 并自动 startPolling 恢复跟踪。
   */
  useEffect(() => {
    if (!taskId) return;
    return onExecutionEvent((event) => {
      if (event.topicId !== taskId) return;
      log.info(S, 'event received, restoring', { type: event.type, executionId: event.executionId });
      restoreExecution();
    });
  }, [taskId, restoreExecution]);

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
