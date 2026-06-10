import { apiRequest } from '@/api/lib';
import type { TasksResponse, Task } from '@/types/task';

const BASE = '/api';
const S = 'taskApi';

export const taskApi = {
  list(projectId: string): Promise<TasksResponse> {
    return apiRequest<TasksResponse>(S, `${BASE}/projects/${projectId}/tasks`);
  },

  create(projectId: string, name: string, summary?: string): Promise<Task> {
    return apiRequest<Task>(S, `${BASE}/projects/${projectId}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ name, summary }),
    });
  },

  update(taskId: string, data: { name?: string; summary?: string }): Promise<Task> {
    return apiRequest<Task>(S, `${BASE}/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  remove(taskId: string): Promise<void> {
    return apiRequest<void>(S, `${BASE}/tasks/${taskId}`, { method: 'DELETE' });
  },
};
