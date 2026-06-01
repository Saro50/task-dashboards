import { apiRequest } from '@/api/lib';
import type { Task, CreateTaskInput, UpdateTaskInput, TaskPlanItem, ImportTaskPlanResponse } from '@/types/task';

const BASE = '/api';
const S = 'taskApi';

export const taskApi = {
  list(projectId: string): Promise<{ tasks: Task[] }> {
    return apiRequest<{ tasks: Task[] }>(S, `${BASE}/projects/${projectId}/tasks`);
  },

  listByTopic(topicId: string): Promise<{ tasks: Task[] }> {
    return apiRequest<{ tasks: Task[] }>(S, `${BASE}/topics/${topicId}/tasks`);
  },

  importPlan(
    projectId: string,
    topic: string,
    summary: string,
    tasks: TaskPlanItem[],
    options?: { chatSessionId?: string; topicId?: string },
  ): Promise<ImportTaskPlanResponse> {
    return apiRequest<ImportTaskPlanResponse>(S, `${BASE}/projects/${projectId}/tasks/import`, {
      method: 'POST',
      body: JSON.stringify({
        topic,
        summary,
        tasks,
        chatSessionId: options?.chatSessionId,
        topicId: options?.topicId,
      }),
    });
  },

  getImportedPlans(sessionId: string): Promise<Array<{ planHash: string; topicName: string; projectId: string; topicId: string | null }>> {
    return apiRequest<Array<{ planHash: string; topicName: string; projectId: string; topicId: string | null }>>(
      S,
      `${BASE}/chat-sessions/${sessionId}/imported-plans`,
    );
  },

  create(projectId: string, input: CreateTaskInput): Promise<Task> {
    return apiRequest<Task>(S, `${BASE}/projects/${projectId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  update(taskId: string, input: UpdateTaskInput): Promise<Task> {
    return apiRequest<Task>(S, `${BASE}/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },

  remove(taskId: string): Promise<void> {
    return apiRequest<void>(S, `${BASE}/tasks/${taskId}`, { method: 'DELETE' });
  },

  addDependency(taskId: string, dependsOnId: string): Promise<{ id: string }> {
    return apiRequest<{ id: string }>(S, `${BASE}/tasks/${taskId}/dependencies`, {
      method: 'POST',
      body: JSON.stringify({ dependsOnId }),
    });
  },

  removeDependency(taskId: string, depId: string): Promise<void> {
    return apiRequest<void>(S, `${BASE}/tasks/${taskId}/dependencies/${depId}`, { method: 'DELETE' });
  },
};
