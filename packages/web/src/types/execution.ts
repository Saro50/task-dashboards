/**
 * 任务链执行相关类型定义。
 *
 * 与后端 Prisma schema 中的 ExecutionStatus 枚举和 TaskExecution 模型一一对应。
 * 前端通过这些类型与后端 API 交互，useTaskExecution hook 中使用 TaskExecution
 * 跟踪执行状态、进度（completedTasks/totalTasks）和 worktree 信息。
 */
export type ExecutionStatus =
  | 'CREATING_WORKTREE'
  | 'RUNNING'
  | 'COMPLETED'
  | 'MERGED'
  | 'STOPPED'
  | 'FAILED';

export interface TaskExecution {
  id: string;
  topicId: string;
  projectId: string;
  status: ExecutionStatus;
  worktreeId: string | null;
  worktreeName: string | null;
  worktreeBranch: string | null;
  worktreeDirectory: string | null;
  sessionId: string | null;
  targetBranch: string | null;
  maxConcurrency: number;
  completedTasks: number;
  totalTasks: number;
  createdAt: string;
  updatedAt: string;
}
