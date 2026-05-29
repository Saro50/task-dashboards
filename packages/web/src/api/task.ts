import type { Task, CreateTaskInput, UpdateTaskInput, TaskPlanItem, ImportTaskPlanResponse } from '@/types/task';

const BASE = '/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const taskApi = {
  list(projectId: string): Promise<{ tasks: Task[] }> {
    return request<{ tasks: Task[] }>(`${BASE}/projects/${projectId}/tasks`);
  },

  listByTopic(topicId: string): Promise<{ tasks: Task[] }> {
    return request<{ tasks: Task[] }>(`${BASE}/topics/${topicId}/tasks`);
  },

  importPlan(projectId: string, topic: string, summary: string, tasks: TaskPlanItem[]): Promise<ImportTaskPlanResponse> {
    return request<ImportTaskPlanResponse>(`${BASE}/projects/${projectId}/tasks/import`, {
      method: 'POST',
      body: JSON.stringify({ topic, summary, tasks }),
    });
  },

  create(projectId: string, input: CreateTaskInput): Promise<Task> {
    return request<Task>(`${BASE}/projects/${projectId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  update(taskId: string, input: UpdateTaskInput): Promise<Task> {
    return request<Task>(`${BASE}/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },

  remove(taskId: string): Promise<void> {
    return request<void>(`${BASE}/tasks/${taskId}`, { method: 'DELETE' });
  },

  addDependency(taskId: string, dependsOnId: string): Promise<{ id: string }> {
    return request<{ id: string }>(`${BASE}/tasks/${taskId}/dependencies`, {
      method: 'POST',
      body: JSON.stringify({ dependsOnId }),
    });
  },

  removeDependency(taskId: string, depId: string): Promise<void> {
    return request<void>(`${BASE}/tasks/${taskId}/dependencies/${depId}`, { method: 'DELETE' });
  },
};
