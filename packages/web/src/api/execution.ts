/**
 * 任务链执行 API 客户端。
 *
 * 对应后端 execution.controller.ts 中的 REST 端点：
 * - start: 启动任务链执行（创建 worktree + AI 会话）
 * - stop: 停止正在运行的执行
 * - merge: 将已完成的执行合并到目标分支
 * - getLatest: 获取主题下最新的执行状态（前端轮询用）
 * - list: 列出主题下所有执行历史
 */
import { apiRequest } from '@/api/lib';
import type { TaskExecution, FileDiff } from '@/types/execution';

const BASE = '/api';
const S = 'executionApi';

export const executionApi = {
  start(topicId: string, projectId: string, maxConcurrency?: number): Promise<TaskExecution> {
    return apiRequest<TaskExecution>(S, `${BASE}/topics/${topicId}/executions`, {
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

  getLatest(topicId: string): Promise<TaskExecution | null> {
    return apiRequest<TaskExecution | null>(S, `${BASE}/topics/${topicId}/executions/latest`);
  },

  list(topicId: string): Promise<TaskExecution[]> {
    return apiRequest<TaskExecution[]>(S, `${BASE}/topics/${topicId}/executions`);
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
};
