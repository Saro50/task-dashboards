import { useState, useEffect, useCallback } from 'react';
import type { TaskTopic, TopicDependency, TopicsResponse } from '@/types/topic';
import type { Task } from '@/types/task';
import { topicApi } from '@/api/topic';
import { log } from '@/utils/log';

const S = 'useTopics';

export function useTopics(projectId: string | undefined) {
  const [topics, setTopics] = useState<TaskTopic[]>([]);
  const [dependencies, setDependencies] = useState<TopicDependency[]>([]);
  const [orphanTasks, setOrphanTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTopics = useCallback(async () => {
    if (!projectId) {
      log.warn(S, 'fetchTopics skipped: no projectId');
      return;
    }
    log.info(S, 'fetchTopics start', { projectId });
    try {
      setLoading(true);
      setError(null);
      const data: TopicsResponse = await topicApi.list(projectId);
      setTopics(data.topics);
      setDependencies(data.dependencies);
      setOrphanTasks(data.orphanTasks);
      log.info(S, 'fetchTopics success', data);
    } catch (err: any) {
      log.error(S, 'fetchTopics error', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchTopics();
  }, [fetchTopics]);

  return { topics, dependencies, orphanTasks, loading, error, refetch: fetchTopics };
}
