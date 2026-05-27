export type ProjectStatus = 'ACTIVE' | 'ARCHIVED';

export interface Project {
  id: string;
  name: string;
  description: string;
  path: string;
  readme: string | null;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  path?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  path?: string;
  readme?: string;
  status?: ProjectStatus;
}
