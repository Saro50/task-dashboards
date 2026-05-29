import type { TopicsResponse, TaskTopic } from '@/types/topic';

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

export const topicApi = {
  list(projectId: string): Promise<TopicsResponse> {
    return request<TopicsResponse>(`${BASE}/projects/${projectId}/topics`);
  },

  create(projectId: string, name: string, summary?: string): Promise<TaskTopic> {
    return request<TaskTopic>(`${BASE}/projects/${projectId}/topics`, {
      method: 'POST',
      body: JSON.stringify({ name, summary }),
    });
  },

  update(topicId: string, data: { name?: string; summary?: string }): Promise<TaskTopic> {
    return request<TaskTopic>(`${BASE}/topics/${topicId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  remove(topicId: string): Promise<void> {
    return request<void>(`${BASE}/topics/${topicId}`, { method: 'DELETE' });
  },
};
