import { useState, useEffect, useCallback } from 'react';
import type { Task } from '@/types/task';
import { taskApi } from '@/api/task';
import { log } from '@/utils/log';

const S = 'useTasks';

export function useTasks(projectId: string | undefined) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    if (!projectId) {
      log.warn(S, 'fetchTasks skipped: no projectId');
      return;
    }
    log.info(S, 'fetchTasks start', { projectId });
    try {
      setLoading(true);
      setError(null);
      const data = await taskApi.list(projectId);
      setTasks(data.tasks);
      log.info(S, 'fetchTasks success', data);
    } catch (err: any) {
      log.error(S, 'fetchTasks error', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const refresh = useCallback(async () => {
    if (!projectId) {
      log.warn(S, 'refresh skipped: no projectId');
      return;
    }
    log.info(S, 'refresh start', { projectId });
    try {
      setError(null);
      const data = await taskApi.list(projectId);
      setTasks(data.tasks);
      log.info(S, 'refresh success', data);
    } catch (err: any) {
      log.error(S, 'refresh error', err);
      setError(err.message);
    }
  }, [projectId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  return { tasks, loading, error, refetch: refresh };
}
