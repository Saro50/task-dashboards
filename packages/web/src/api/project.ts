import { apiRequest } from '@/api/lib';
import type { Project, CreateProjectInput, UpdateProjectInput, ProjectStatus } from '@/types/project';

const BASE = '/api/projects';
const S = 'projectApi';

export interface DirCheckResult {
  exists: boolean;
  isGitRepo: boolean;
  absolutePath: string;
}

export const projectApi = {
  list(): Promise<Project[]> {
    return apiRequest<Project[]>(S, BASE);
  },
  getById(id: string): Promise<Project> {
    return apiRequest<Project>(S, `${BASE}/${id}`);
  },
  create(input: CreateProjectInput): Promise<Project> {
    return apiRequest<Project>(S, BASE, { method: 'POST', body: JSON.stringify(input) });
  },
  update(id: string, input: UpdateProjectInput): Promise<Project> {
    return apiRequest<Project>(S, `${BASE}/${id}`, { method: 'PUT', body: JSON.stringify(input) });
  },
  remove(id: string): Promise<void> {
    return apiRequest<void>(S, `${BASE}/${id}`, { method: 'DELETE' });
  },
  updateStatus(id: string, status: ProjectStatus): Promise<Project> {
    return apiRequest<Project>(S, `${BASE}/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
  },
  checkDirectory(dirPath: string): Promise<DirCheckResult> {
    return apiRequest<DirCheckResult>(S, `${BASE}/check-directory`, { method: 'POST', body: JSON.stringify({ path: dirPath }) });
  },
  ensureDirectory(dirPath: string): Promise<DirCheckResult> {
    return apiRequest<DirCheckResult>(S, `${BASE}/ensure-directory`, { method: 'POST', body: JSON.stringify({ path: dirPath }) });
  },
  healthCheck(id: string): Promise<Project> {
    return apiRequest<Project>(S, `${BASE}/${id}/health-check`, { method: 'POST' });
  },
};
