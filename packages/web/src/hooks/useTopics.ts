import { useState, useEffect, useCallback } from 'react';
import type { TaskTopic, TopicDependency, TopicsResponse } from '@/types/topic';
import type { Task } from '@/types/task';
import { topicApi } from '@/api/topic';

export function useTopics(projectId: string | undefined) {
  const [topics, setTopics] = useState<TaskTopic[]>([]);
  const [dependencies, setDependencies] = useState<TopicDependency[]>([]);
  const [orphanTasks, setOrphanTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTopics = useCallback(async () => {
    if (!projectId) return;
    try {
      setLoading(true);
      setError(null);
      const data: TopicsResponse = await topicApi.list(projectId);
      setTopics(data.topics);
      setDependencies(data.dependencies);
      setOrphanTasks(data.orphanTasks);
    } catch (err: any) {
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
