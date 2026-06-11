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
 * │ 6. restartExecution  重新执行（停止旧 execution、清理后重新开始）  │
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
        // CONFLICTING 状态不停止轮询以外的操作，等待用户手动处理
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
          emitExecutionEvent({ type: 'started', executionId: exec.id, taskId: taskId });
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
      emitExecutionEvent({ type: 'stopped', executionId: execution.id, taskId: execution.taskId });
    } catch (err: any) {
      log.error(S, 'cancelExecution error', err);
      showToast(err.message, 'error');
    }
  }, [execution, showToast, stopPolling, onStepUpdated]);

  /**
   * 重新执行 — 停止旧 execution、清理 worktree、重置所有步骤为 PENDING，
   * 然后创建全新 execution + worktree + AI 会话从头执行。
   *
   * restart 内部已完成旧 execution 的清理（abortSession + removeWorktree + stop），
   * 外部无需先调用 cancelExecution。
   *
   * 上游影响：
   *   - 前端「重新执行」按钮 → restartExecution
   *   - 旧 execution 被标记为 STOPPED，新 execution 接管执行
   *   - 所有步骤（含 COMPLETED/BLOCKED）被重置为 PENDING
   */
  const restartExecution = useCallback(async () => {
    if (!taskId || !projectId) {
      log.warn(S, 'restartExecution skipped: missing taskId or projectId');
      return;
    }
    log.info(S, 'restartExecution', { taskId, projectId, maxConcurrency });
    setExecuting(true);

    try {
      const exec = await executionApi.restart(taskId, projectId, maxConcurrency);
      log.info(S, 'execution restarted', { id: exec.id, status: exec.status });
      setExecution(exec);
      startPolling(exec.id);
      showToast('任务链重新执行已开始', 'success');
      emitExecutionEvent({ type: 'started', executionId: exec.id, taskId });
    } catch (err: any) {
      log.error(S, 'restartExecution error', err);
      showToast(err.message, 'error');
      setExecuting(false);
    }
  }, [taskId, projectId, maxConcurrency, showToast, startPolling]);

  /**
   * 合并操作 — 将 worktree 中的代码变更 squash merge 到用户选择的目标分支。
   *
   * 后端执行步骤（见 execution.service.ts::merge）：
   *   1. 在 worktree 目录 git add -A + git commit（opencode 不会自动 commit）
   *   2. 切换到目标分支，执行 git merge --squash worktreeBranch
   *   3. 如有冲突 → abort → 返回 409 + conflictFiles → 抛出带 conflictFiles 的错误
   *   4. 如有变更则 git commit，无变更则跳过
   *   5. 删除 worktree，将 execution 状态标记为 MERGED
   */
  const mergeExecution = useCallback(async (targetBranch: string) => {
    if (!execution) return;
    log.info(S, 'mergeExecution', { executionId: execution.id, targetBranch });
    try {
      const updated = await executionApi.merge(execution.id, targetBranch);
      setExecution(updated);
      showToast(`已合并到 ${targetBranch}`, 'success');
      emitExecutionEvent({ type: 'merged', executionId: execution.id, taskId: execution.taskId });
    } catch (err: any) {
      log.error(S, 'mergeExecution error', err);
      // 409 冲突时将 conflictFiles 附加到错误对象，让 MergeDialog 展示
      if (err.status === 409 && err.data?.conflictFiles) {
        const conflictErr: any = new Error(err.data.error ?? '合并冲突');
        conflictErr.conflictFiles = err.data.conflictFiles;
        throw conflictErr;
      }
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
   * 恢复路径：
   *   - RUNNING / CREATING_WORKTREE → 恢复轮询，继续跟踪执行进度
   *   - CONFLICTING → 仅恢复 execution 值（冲突解决面板由 UI 层驱动）
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
   * 强制合并 — 不在冲突时 abort，将执行推进到 CONFLICTING 状态。
   * 用户选择「手动解决冲突」时调用。
   *
   * 上游影响：
   *   - MergeDialog「手动解决冲突」按钮 → 此方法
   *   - 将 execution.status 从 COMPLETED 推进到 CONFLICTING
   */
  const mergeForce = useCallback(async (targetBranch: string) => {
    if (!execution) return;
    log.info(S, 'mergeForce', { executionId: execution.id, targetBranch });
    try {
      const result = await executionApi.mergeForce(execution.id, targetBranch);
      if (result.status === 'CONFLICTING') {
        // 刷新 execution 状态
        const latest = await executionApi.getLatest(taskId!);
        if (latest) setExecution(latest);
        showToast(`检测到 ${result.conflictFiles.length} 个冲突文件，请手动解决`, 'info');
      } else {
        // 无冲突，直接 MERGED
        const latest = await executionApi.getLatest(taskId!);
        if (latest) setExecution(latest);
        showToast(`已合并到 ${targetBranch}`, 'success');
        emitExecutionEvent({ type: 'merged', executionId: execution.id, taskId: execution.taskId });
      }
      return result;
    } catch (err: any) {
      log.error(S, 'mergeForce error', err);
      showToast(err.message, 'error');
      throw err;
    }
  }, [execution, taskId, showToast]);

  /**
   * 确认冲突已解决 — 检查 git index，若已解决则完成合并。
   *
   * 上游影响：
   *   - ConflictResolutionPanel「冲突已解决」按钮 → 此方法
   *   - 成功时将 execution.status 从 CONFLICTING 推进到 MERGED
   */
  const resolveConflict = useCallback(async () => {
    if (!execution) return;
    log.info(S, 'resolveConflict', { executionId: execution.id });
    try {
      const result = await executionApi.resolveConflict(execution.id);
      if (result.resolved) {
        const latest = await executionApi.getLatest(taskId!);
        if (latest) setExecution(latest);
        showToast('冲突已解决，合并完成', 'success');
        emitExecutionEvent({ type: 'merged', executionId: execution.id, taskId: execution.taskId });
      } else {
        showToast(`仍有 ${result.remainingFiles?.length ?? 0} 个文件未解决冲突`, 'info');
      }
      return result;
    } catch (err: any) {
      log.error(S, 'resolveConflict error', err);
      showToast(err.message, 'error');
      throw err;
    }
  }, [execution, taskId, showToast]);

  /**
   * 放弃冲突解决 — abort merge，状态回退到 COMPLETED。
   *
   * 上游影响：
   *   - ConflictResolutionPanel「放弃解决」按钮 → 此方法
   *   - 将 execution.status 从 CONFLICTING 回退到 COMPLETED
   */
  const abortConflict = useCallback(async () => {
    if (!execution) return;
    log.info(S, 'abortConflict', { executionId: execution.id });
    try {
      const updated = await executionApi.abortConflict(execution.id);
      setExecution(updated);
      showToast('已放弃冲突解决，可重新选择分支合并', 'info');
    } catch (err: any) {
      log.error(S, 'abortConflict error', err);
      showToast(err.message, 'error');
    }
  }, [execution, showToast]);

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
      if (event.taskId !== taskId) return;
      log.info(S, 'event received, restoring', { type: event.type, executionId: event.executionId });
      restoreExecution();
    });
  }, [taskId, restoreExecution]);

  return {
    executeChain,
    cancelExecution,
    restartExecution,
    mergeExecution,
    mergeForce,
    resolveConflict,
    abortConflict,
    restoreExecution,
    executing,
    execution,
    sessionMessages,
  };
}
