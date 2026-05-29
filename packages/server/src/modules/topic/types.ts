export interface TopicWithStats {
  id: string;
  projectId: string;
  name: string;
  summary: string;
  taskCount: number;
  completedCount: number;
  aggregatedStatus: 'COMPLETED' | 'IN_PROGRESS' | 'BLOCKED' | 'PENDING';
  createdAt: string;
  updatedAt: string;
}

export interface TopicDependency {
  sourceId: string;
  targetId: string;
}
