export type AggregatedStatus = 'COMPLETED' | 'IN_PROGRESS' | 'BLOCKED' | 'PENDING';

export interface TaskTopic {
  id: string;
  projectId: string;
  name: string;
  summary: string;
  taskCount: number;
  completedCount: number;
  aggregatedStatus: AggregatedStatus;
  /** 主题下所有任务的 input token 累计 */
  tokenInput: number;
  /** 主题下所有任务的 output token 累计 */
  tokenOutput: number;
  /** 主题下所有任务的缓存命中 token 累计 */
  cacheRead: number;
  createdAt: string;
  updatedAt: string;
}

export interface TopicDependency {
  sourceId: string;
  targetId: string;
}

export interface TopicsResponse {
  topics: TaskTopic[];
  dependencies: TopicDependency[];
  orphanTasks: import('./task').Task[];
}
