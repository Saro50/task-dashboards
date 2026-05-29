import { useState, useCallback, useRef } from 'react';
import type { Task } from '@/types/task';
import { taskApi } from '@/api/task';
import { useToast } from '@/components/Toast';

function buildPrompt(task: Task, deps: (Task | undefined)[]): string {
  const lines: string[] = [
    '请执行以下任务：',
    '',
    `## 任务：${task.title}`,
  ];

  if (task.description) {
    lines.push(task.description);
  }

  const validDeps = deps.filter((d): d is Task => d != null);
  if (validDeps.length > 0) {
    lines.push('', '## 前置依赖');
    for (const dep of validDeps) {
      lines.push(`- ${dep.title}（${dep.status}）：${dep.description || '无描述'}`);
    }
  }

  lines.push('', '请根据依赖任务的完成情况，开始执行当前任务。');
  return lines.join('\n');
}

function getNextTasks(tasks: Task[]): Task[] {
  return tasks.filter(
    (t) =>
      t.status === 'PENDING' &&
      t.dependencies.every((depId) => tasks.find((t2) => t2.id === depId)?.status === 'COMPLETED')
  );
}

interface UseTaskExecutionOptions {
  topicId: string | undefined;
  onTaskUpdated: () => void;
}

export function useTaskExecution({ topicId, onTaskUpdated }: UseTaskExecutionOptions) {
  const { showToast } = useToast();
  const [executing, setExecuting] = useState(false);
  const cancelled = useRef(false);

  const executeNext = useCallback(
    async (tasks: Task[]) => {
      if (cancelled.current) {
        setExecuting(false);
        return;
      }

      const next = getNextTasks(tasks);
      if (next.length === 0) {
        setExecuting(false);
        const hasPending = tasks.some((t) => t.status === 'PENDING');
        showToast(hasPending ? '存在阻塞任务，无法继续' : '所有任务已执行完毕', 'info');
        return;
      }

      const task = next[0];

      await taskApi.update(task.id, { status: 'IN_PROGRESS' });
      onTaskUpdated();
      showToast(`正在执行：${task.title}`, 'success');

      const deps = task.dependencies.map((id) => tasks.find((t) => t.id === id)).filter(Boolean);
      const prompt = buildPrompt(task, deps);
      console.log('[useTaskExecution] executeNext', {
        taskId: task.id,
        title: task.title,
        agent: 'build',
        prompt,
        dependencyCount: deps.length,
        remainingPending: tasks.filter((t) => t.status === 'PENDING').length - 1,
      });

      setTimeout(async () => {
        if (cancelled.current) {
          setExecuting(false);
          return;
        }

        await taskApi.update(task.id, { status: 'COMPLETED' });
        onTaskUpdated();
        showToast(`已完成：${task.title}`, 'success');

        if (!topicId) {
          setExecuting(false);
          return;
        }

        try {
          const { tasks: refreshedTasks } = await taskApi.listByTopic(topicId);
          executeNext(refreshedTasks);
        } catch {
          setExecuting(false);
        }
      }, 3000);
    },
    [topicId, onTaskUpdated, showToast]
  );

  const executeChain = useCallback(
    async (tasks: Task[]) => {
      if (executing) return;
      cancelled.current = false;
      setExecuting(true);
      executeNext(tasks);
    },
    [executing, executeNext]
  );

  const cancelExecution = useCallback(() => {
    cancelled.current = true;
    setExecuting(false);
    showToast('已停止执行', 'info');
  }, [showToast]);

  return { executeChain, cancelExecution, executing };
}
