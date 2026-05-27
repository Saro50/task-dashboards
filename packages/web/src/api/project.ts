import type { Project, CreateProjectInput, UpdateProjectInput, ProjectStatus } from '@/types/project';

const BASE = '/api/projects';

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

export interface DirCheckResult {
  exists: boolean;
  isGitRepo: boolean;
  absolutePath: string;
}

export const projectApi = {
  list(): Promise<Project[]> {
    return request<Project[]>(BASE);
  },
  getById(id: string): Promise<Project> {
    return request<Project>(`${BASE}/${id}`);
  },
  create(input: CreateProjectInput): Promise<Project> {
    return request<Project>(BASE, { method: 'POST', body: JSON.stringify(input) });
  },
  update(id: string, input: UpdateProjectInput): Promise<Project> {
    return request<Project>(`${BASE}/${id}`, { method: 'PUT', body: JSON.stringify(input) });
  },
  remove(id: string): Promise<void> {
    return request<void>(`${BASE}/${id}`, { method: 'DELETE' });
  },
  updateStatus(id: string, status: ProjectStatus): Promise<Project> {
    return request<Project>(`${BASE}/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
  },
  checkDirectory(dirPath: string): Promise<DirCheckResult> {
    return request<DirCheckResult>(`${BASE}/check-directory`, { method: 'POST', body: JSON.stringify({ path: dirPath }) });
  },
  ensureDirectory(dirPath: string): Promise<DirCheckResult> {
    return request<DirCheckResult>(`${BASE}/ensure-directory`, { method: 'POST', body: JSON.stringify({ path: dirPath }) });
  },
  healthCheck(id: string): Promise<Project> {
    return request<Project>(`${BASE}/${id}/health-check`, { method: 'POST' });
  },
};
