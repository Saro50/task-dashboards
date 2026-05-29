export type AggregatedStatus = 'COMPLETED' | 'IN_PROGRESS' | 'BLOCKED' | 'PENDING';

export interface TaskTopic {
  id: string;
  projectId: string;
  name: string;
  summary: string;
  taskCount: number;
  completedCount: number;
  aggregatedStatus: AggregatedStatus;
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
