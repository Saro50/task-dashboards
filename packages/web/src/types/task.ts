export type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED';

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: TaskStatus;
  blockedReason: string | null;
  topicId: string | null;
  createdAt: string;
  updatedAt: string;
  dependencies: string[];
}

export interface CreateTaskInput {
  title: string;
  description?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  topicId?: string | null;
}

export interface TaskPlanItem {
  ref: string;
  title: string;
  description: string;
  dependencies: string[];
}

export interface TaskPlan {
  version: '1.0';
  topic: string;
  summary: string;
  tasks: TaskPlanItem[];
}

export interface ImportTaskPlanResponse {
  topicId: string;
  imported: number;
  tasks: {
    id: string;
    ref: string;
    title: string;
    status: string;
  }[];
  dependencies: number;
}
