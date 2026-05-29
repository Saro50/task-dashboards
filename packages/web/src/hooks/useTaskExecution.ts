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
  const [maxConcurrency, setMaxConcurrency] = useState(2);
  const cancelled = useRef(false);
  const runningCount = useRef(0);
  const starting = useRef(false);

  const tryStartMore = useCallback(async () => {
    if (cancelled.current) {
      if (runningCount.current === 0) setExecuting(false);
      return;
    }
    if (starting.current) return;
    if (!topicId) return;

    starting.current = true;
    try {
      const { tasks } = await taskApi.listByTopic(topicId);
      const available = getNextTasks(tasks);
      const slots = maxConcurrency - runningCount.current;
      const toStart = available.slice(0, Math.max(0, slots));

      if (toStart.length === 0 && runningCount.current === 0) {
        setExecuting(false);
        const hasPending = tasks.some((t) => t.status === 'PENDING');
        showToast(hasPending ? '存在阻塞任务，无法继续' : '所有任务已执行完毕', 'info');
        return;
      }

      for (const task of toStart) {
        if (cancelled.current) break;

        runningCount.current++;
        await taskApi.update(task.id, { status: 'IN_PROGRESS' });
        onTaskUpdated();
        showToast(`正在执行：${task.title}`, 'success');

        const deps = task.dependencies.map((id) => tasks.find((t) => t.id === id)).filter(Boolean);
        const prompt = buildPrompt(task, deps);
        console.log('[useTaskExecution] start', {
          taskId: task.id,
          title: task.title,
          agent: 'build',
          prompt,
          runningCount: runningCount.current,
          remainingPending: tasks.filter((t) => t.status === 'PENDING').length - 1,
        });

        const taskId = task.id;
        const taskTitle = task.title;
        let randomTim = Math.random() * 1000;
        setTimeout(async () => {
          if (cancelled.current) {
            runningCount.current--;
            if (runningCount.current === 0) setExecuting(false);
            return;
          }

          await taskApi.update(taskId, { status: 'COMPLETED' });
          runningCount.current--;
          onTaskUpdated();
          showToast(`已完成：${taskTitle}`, 'success');

          tryStartMore();
        }, 3000);
      }
    } catch {
      if (runningCount.current === 0) setExecuting(false);
    } finally {
      starting.current = false;
    }
  }, [topicId, maxConcurrency, onTaskUpdated, showToast]);

  const executeChain = useCallback(
    (tasks: Task[]) => {
      if (executing) return;
      cancelled.current = false;
      runningCount.current = 0;
      setExecuting(true);
      tryStartMore();
    },
    [executing, tryStartMore]
  );

  const cancelExecution = useCallback(() => {
    cancelled.current = true;
    showToast('正在停止执行...', 'info');
  }, [showToast]);

  return { executeChain, cancelExecution, executing, maxConcurrency, setMaxConcurrency };
}
