export type AggregatedStatus = 'COMPLETED' | 'IN_PROGRESS' | 'BLOCKED' | 'PENDING';

export interface Task {
  id: string;
  projectId: string;
  name: string;
  summary: string;
  stepCount: number;
  completedStepCount: number;
  aggregatedStatus: AggregatedStatus;
  /** 任务下所有步骤的 input token 累计 */
  tokenInput: number;
  /** 任务下所有步骤的 output token 累计 */
  tokenOutput: number;
  /** 任务下所有步骤的缓存命中 token 累计 */
  cacheRead: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDependency {
  sourceId: string;
  targetId: string;
}

export interface TasksResponse {
  tasks: Task[];
  dependencies: TaskDependency[];
  orphanSteps: import('./step').Step[];
}
