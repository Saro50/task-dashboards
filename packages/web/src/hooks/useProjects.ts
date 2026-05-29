import { useState, useEffect, useCallback } from 'react';
import type { Project } from '@/types/project';
import { projectApi } from '@/api/project';
import { log } from '@/utils/log';

const S = 'useProjects';

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    log.info(S, 'fetchProjects start');
    try {
      setLoading(true);
      setError(null);
      const data = await projectApi.list();
      setProjects(data);
      log.info(S, 'fetchProjects success', { projects: data });
    } catch (err: any) {
      log.error(S, 'fetchProjects error', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  return { projects, loading, error, refetch: fetchProjects };
}
