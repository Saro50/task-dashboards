import { apiRequest } from '@/api/lib';
import type { TopicsResponse, TaskTopic } from '@/types/topic';

const BASE = '/api';
const S = 'topicApi';

export const topicApi = {
  list(projectId: string): Promise<TopicsResponse> {
    return apiRequest<TopicsResponse>(S, `${BASE}/projects/${projectId}/topics`);
  },

  create(projectId: string, name: string, summary?: string): Promise<TaskTopic> {
    return apiRequest<TaskTopic>(S, `${BASE}/projects/${projectId}/topics`, {
      method: 'POST',
      body: JSON.stringify({ name, summary }),
    });
  },

  update(topicId: string, data: { name?: string; summary?: string }): Promise<TaskTopic> {
    return apiRequest<TaskTopic>(S, `${BASE}/topics/${topicId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  remove(topicId: string): Promise<void> {
    return apiRequest<void>(S, `${BASE}/topics/${topicId}`, { method: 'DELETE' });
  },
};
