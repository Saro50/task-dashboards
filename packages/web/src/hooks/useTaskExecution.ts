import { useState, useCallback, useRef } from 'react';
import type { Task } from '@/types/task';
import { taskApi } from '@/api/task';
import { useToast } from '@/components/Toast';
import { log } from '@/utils/log';

const S = 'useTaskExecution';

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
      log.warn(S, 'tryStartMore cancelled', { runningCount: runningCount.current });
      if (runningCount.current === 0) setExecuting(false);
      return;
    }
    if (starting.current) {
      log.warn(S, 'tryStartMore skipped: starting lock');
      return;
    }
    if (!topicId) {
      log.warn(S, 'tryStartMore skipped: no topicId');
      return;
    }

    starting.current = true;
    try {
      const resp = await taskApi.listByTopic(topicId);
      const { tasks } = resp;
      log.info(S, 'tryStartMore listByTopic response', resp);

      const available = getNextTasks(tasks);
      const slots = maxConcurrency - runningCount.current;
      const toStart = available.slice(0, Math.max(0, slots));
      log.info(S, 'tryStartMore available tasks', {
        available: available.map((t) => ({ id: t.id, title: t.title })),
        running: runningCount.current,
        slots,
        toStart: toStart.map((t) => ({ id: t.id, title: t.title })),
      });

      if (toStart.length === 0 && runningCount.current === 0) {
        setExecuting(false);
        const hasPending = tasks.some((t) => t.status === 'PENDING');
        if (hasPending) {
          log.warn(S, 'tryStartMore blocked tasks remain', {
            tasks: tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, dependencies: t.dependencies })),
          });
        } else {
          log.info(S, 'tryStartMore all tasks completed');
        }
        showToast(hasPending ? '存在阻塞任务，无法继续' : '所有任务已执行完毕', 'info');
        return;
      }

      for (const task of toStart) {
        if (cancelled.current) break;

        runningCount.current++;
        log.info(S, 'tryStartMore starting task', {
          taskId: task.id,
          title: task.title,
          runningCount: runningCount.current,
        });

        const updateResp = await taskApi.update(task.id, { status: 'IN_PROGRESS' });
        log.info(S, 'task update IN_PROGRESS response', updateResp);
        onTaskUpdated();
        showToast(`正在执行：${task.title}`, 'success');

        const deps = task.dependencies.map((id) => tasks.find((t) => t.id === id)).filter(Boolean);
        const prompt = buildPrompt(task, deps);
        log.info(S, 'task started (simulated)', {
          taskId: task.id,
          title: task.title,
          agent: 'build',
          prompt,
          runningCount: runningCount.current,
        });

        const taskId = task.id;
        const taskTitle = task.title;
        const randomTim = Math.random() * 20;
        setTimeout(async () => {
          if (cancelled.current) {
            runningCount.current--;
            log.warn(S, 'task cancelled (simulated)', { taskId, runningCount: runningCount.current });
            if (runningCount.current === 0) setExecuting(false);
            return;
          }

          const completeResp = await taskApi.update(taskId, { status: 'COMPLETED' });
          log.info(S, 'task update COMPLETED response', completeResp);
          runningCount.current--;
          onTaskUpdated();
          showToast(`已完成：${taskTitle}`, 'success');
          log.info(S, 'task completed (simulated)', { taskId, title: taskTitle, elapsed: `${randomTim.toFixed(1)}s`, runningCount: runningCount.current });
          tryStartMore();
        }, randomTim * 1000);
      }
    } catch (err: any) {
      log.error(S, 'tryStartMore error', err);
      if (runningCount.current === 0) setExecuting(false);
    } finally {
      starting.current = false;
    }
  }, [topicId, maxConcurrency, onTaskUpdated, showToast]);

  const executeChain = useCallback(
    (tasks: Task[]) => {
      if (executing) {
        log.warn(S, 'executeChain skipped: already executing');
        return;
      }
      log.info(S, 'executeChain start', { tasks: tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, dependencies: t.dependencies })), maxConcurrency });
      cancelled.current = false;
      runningCount.current = 0;
      setExecuting(true);
      tryStartMore();
    },
    [executing, tryStartMore, maxConcurrency]
  );

  const cancelExecution = useCallback(() => {
    log.info(S, 'cancelExecution', { runningCount: runningCount.current });
    cancelled.current = true;
    showToast('正在停止执行...', 'info');
  }, [showToast]);

  return { executeChain, cancelExecution, executing, maxConcurrency, setMaxConcurrency };
}
