import { useState, useEffect, useCallback } from 'react';
import type { Project } from '@/types/project';
import { projectApi } from '@/api/project';
import { log } from '@/utils/log';

const S = 'useProject';

export function useProject(projectId: string | undefined) {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProject = useCallback(async () => {
    if (!projectId) return;
    log.info(S, 'fetchProject start', { projectId });
    try {
      setLoading(true);
      setError(null);
      const data = await projectApi.getById(projectId);
      setProject(data);
      log.info(S, 'fetchProject success', { name: data.name });
    } catch (err: any) {
      log.error(S, 'fetchProject error', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  return { project, loading, error, refetch: fetchProject };
}
