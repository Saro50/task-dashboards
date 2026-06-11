/**
 * 任务链执行 API 客户端。
 *
 * 对应后端 execution.controller.ts 中的 REST 端点：
 * - start: 启动任务链执行（创建 worktree + AI 会话）
 * - stop: 停止正在运行的执行
 * - merge: 将已完成的执行合并到目标分支（冲突时返回 409 + conflictFiles）
 * - mergeForce: 强制合并，冲突时进入 CONFLICTING 状态（不 abort）
 * - resolveConflict: 确认冲突已解决 → 完成合并
 * - abortConflict: 放弃冲突解决 → 回退到 COMPLETED
 * - getLatest: 获取任务下最新的执行状态（前端轮询用）
 * - list: 列出任务下所有执行历史
 * - getStepDiff: 获取单个步骤的文件变更（per-step diff）
 */
import { apiRequest } from '@/api/lib';
import type { TaskExecution, FileDiff } from '@/types/execution';
import type { SessionMessage } from '@/types/session-message';

const BASE = '/api';
const S = 'executionApi';

export const executionApi = {
  start(taskId: string, projectId: string, maxConcurrency?: number): Promise<TaskExecution> {
    return apiRequest<TaskExecution>(S, `${BASE}/tasks/${taskId}/executions`, {
      method: 'POST',
      body: JSON.stringify({ projectId, maxConcurrency }),
    });
  },

  stop(executionId: string): Promise<TaskExecution> {
    return apiRequest<TaskExecution>(S, `${BASE}/executions/${executionId}/stop`, {
      method: 'POST',
    });
  },

  merge(executionId: string, targetBranch: string): Promise<TaskExecution> {
    return apiRequest<TaskExecution>(S, `${BASE}/executions/${executionId}/merge`, {
      method: 'POST',
      body: JSON.stringify({ targetBranch }),
    });
  },

  /**
   * 强制合并 — 不在冲突时 abort，将执行推进到 CONFLICTING 状态。
   * 返回 { status, conflictFiles } 而非 TaskExecution。
   */
  mergeForce(executionId: string, targetBranch: string): Promise<{ status: string; conflictFiles: string[] }> {
    return apiRequest<{ status: string; conflictFiles: string[] }>(S, `${BASE}/executions/${executionId}/merge-force`, {
      method: 'POST',
      body: JSON.stringify({ targetBranch }),
    });
  },

  /**
   * 确认冲突已解决 — 检查 git index，若已解决则完成合并。
   */
  resolveConflict(executionId: string): Promise<{ resolved: boolean; remainingFiles?: string[] }> {
    return apiRequest<{ resolved: boolean; remainingFiles?: string[] }>(S, `${BASE}/executions/${executionId}/resolve-conflict`, {
      method: 'POST',
    });
  },

  /**
   * 放弃冲突解决 — abort merge，状态回退到 COMPLETED。
   */
  abortConflict(executionId: string): Promise<TaskExecution> {
    return apiRequest<TaskExecution>(S, `${BASE}/executions/${executionId}/abort-conflict`, {
      method: 'POST',
    });
  },

  getLatest(taskId: string): Promise<TaskExecution | null> {
    return apiRequest<TaskExecution | null>(S, `${BASE}/tasks/${taskId}/executions/latest`);
  },

  list(taskId: string): Promise<TaskExecution[]> {
    return apiRequest<TaskExecution[]>(S, `${BASE}/tasks/${taskId}/executions`);
  },

  getMessages(executionId: string): Promise<{ messages: any[] }> {
    return apiRequest<{ messages: any[] }>(S, `${BASE}/executions/${executionId}/messages`);
  },

  getDiff(executionId: string): Promise<{ diffs: FileDiff[] }> {
    return apiRequest<{ diffs: FileDiff[] }>(S, `${BASE}/executions/${executionId}/diff`);
  },

  getBranches(executionId: string): Promise<{ branches: string[]; current: string }> {
    return apiRequest<{ branches: string[]; current: string }>(S, `${BASE}/executions/${executionId}/branches`);
  },

  getActive(projectId: string): Promise<TaskExecution[]> {
    return apiRequest<TaskExecution[]>(S, `${BASE}/projects/${projectId}/executions/active`);
  },

  getStepDiff(stepId: string, executionId: string): Promise<{ diffs: FileDiff[] }> {
    return apiRequest<{ diffs: FileDiff[] }>(S, `${BASE}/steps/${stepId}/diff?executionId=${executionId}`);
  },

  getStepMessages(stepId: string, executionId: string): Promise<{ messages: SessionMessage[]; unavailable?: boolean }> {
    return apiRequest<{ messages: SessionMessage[]; unavailable?: boolean }>(S, `${BASE}/steps/${stepId}/messages?executionId=${executionId}`);
  },
};
