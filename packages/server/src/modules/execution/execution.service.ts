/**
 * 任务链执行服务 — 核心业务逻辑。
 *
 * 执行流程：
 *   start() → 创建 TaskExecution 记录 → 异步调用 runExecution()
 *   runExecution() → 创建 worktree → 创建 AI 会话 → 调用 executeTasks()
 *   executeTasks() → 按 DAG 拓扑顺序批量执行任务：
 *     1. 找出所有依赖已满足的 PENDING 任务（下一批可执行的任务）
 *     2. 按 maxConcurrency 截取本批任务数量
 *     3. 逐个 await sendPrompt 发送到 AI 会话
 *     4. await waitForSessionIdle 等待 AI 处理完本批所有任务
 *     5. 标记本批任务为 COMPLETED，递归调用 executeTasks 处理下一批
 *     6. 无更多任务时将执行标记为 COMPLETED
 *
 * 为什么用批量模式而非逐任务 waitForSessionIdle：
 *   所有任务共享同一个 AI 会话，如果对每个任务单独 waitForSessionIdle，
 *   当 maxConcurrency > 1 时，多个 wait 会在同一时刻 resolve（因为 session idle
 *   是全局状态），导致多个回调同时标记任务完成并递归 executeTasks，产生竞态条件。
 *   批量模式确保每批只有一个 waitForSessionIdle 调用，完成后统一处理，再进入下一批。
 *
 * stop() → 中止 AI 会话 + 将 IN_PROGRESS 任务重置为 PENDING
 * merge() → 将执行标记为 MERGED 并记录目标分支
 */
import { ExecutionStatus } from '@prisma/client';
import prisma from '../../prisma.js';
import * as EngineService from '../engine/engine.service.js';
import * as OpencodeV2 from '../engine/opencode-v2.js';
import * as TaskService from '../task/task.service.js';
import { logger } from '../../logger.js';

const S = 'execution.service';

interface TaskWithDeps {
  id: string;
  title: string;
  description: string;
  status: string;
  dependencies: string[];
}

// 构建发送给 AI 的任务提示词，包含任务描述和已完成的前置依赖信息，
// 让 AI 了解上下文，避免重复已完成的工作。
function buildPrompt(task: TaskWithDeps, deps: TaskWithDeps[]): string {
  const lines: string[] = [
    '请执行以下任务：',
    '',
    `## 任务：${task.title}`,
  ];
  if (task.description) lines.push(task.description);
  const validDeps = deps.filter((d) => d.status === 'COMPLETED');
  if (validDeps.length > 0) {
    lines.push('', '## 前置依赖（已完成）');
    for (const dep of validDeps) {
      lines.push(`- ${dep.title}：${dep.description || '无描述'}`);
    }
  }
  lines.push('', '请开始执行当前任务，完成后简要说明做了什么。');
  return lines.join('\n');
}

// 获取下一批可执行的任务：状态为 PENDING 且所有依赖都已完成。
// 这是 DAG 拓扑排序的核心逻辑。
function getNextTasks(tasks: TaskWithDeps[]): TaskWithDeps[] {
  return tasks.filter(
    (t) =>
      t.status === 'PENDING' &&
      t.dependencies.every((depId) => tasks.find((t2) => t2.id === depId)?.status === 'COMPLETED'),
  );
}

export async function start(topicId: string, projectId: string, maxConcurrency: number = 2) {
  const topic = await prisma.taskTopic.findUnique({ where: { id: topicId } });
  if (!topic) throw new Error('Topic not found');

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || !project.path) throw new Error('Project not found or no path configured');

  // 防止同一主题重复启动执行
  const existing = await prisma.taskExecution.findFirst({
    where: { topicId, status: { in: ['CREATING_WORKTREE', 'RUNNING'] } },
  });
  if (existing) throw new Error('An execution is already running for this topic');

  const tasks = await TaskService.listByTopic(topicId);
  const pendingTasks = tasks.filter((t) => t.status === 'PENDING');
  if (pendingTasks.length === 0) throw new Error('No pending tasks to execute');

  // 查找可复用的 STOPPED worktree：用户中断后修改任务再继续，应沿用同一分支推进
  const stopped = await prisma.taskExecution.findFirst({
    where: {
      topicId,
      status: 'STOPPED',
      worktreeDirectory: { not: null },
    },
    orderBy: { createdAt: 'desc' },
  });

  const execution = await prisma.taskExecution.create({
    data: {
      topicId,
      projectId,
      status: 'CREATING_WORKTREE' as ExecutionStatus,
      maxConcurrency,
      totalTasks: tasks.length,
      completedTasks: 0,
      ...(stopped ? {
        worktreeName: stopped.worktreeName,
        worktreeBranch: stopped.worktreeBranch,
        worktreeDirectory: stopped.worktreeDirectory,
      } : {}),
    },
  });

  const reuseWorktree = stopped ? {
    directory: stopped.worktreeDirectory!,
    branch: stopped.worktreeBranch,
    name: stopped.worktreeName,
  } : undefined;

  runExecution(execution.id, project.path, topic.name, maxConcurrency, reuseWorktree).catch((err) => {
    logger.error(S, 'runExecution fatal error', err);
  });

  return execution;
}

// 创建 worktree 隔离环境 → 创建 AI 会话 → 开始执行任务
async function runExecution(
  executionId: string,
  projectPath: string,
  topicName: string,
  maxConcurrency: number,
  existingWorktree?: { directory: string; branch: string | null; name: string | null },
) {
  try {
    const baseUrl = await EngineService.getBaseUrl();

    let worktreeDir: string;
    let wtName: string | null;
    let wtBranch: string | null;

    if (existingWorktree) {
      logger.info(S, 'reusing existing worktree', { executionId, directory: existingWorktree.directory });
      worktreeDir = existingWorktree.directory;
      wtName = existingWorktree.name;
      wtBranch = existingWorktree.branch;
    } else {
      const worktreeName = `exec-${topicName.slice(0, 16)}-${Date.now()}`;
      logger.info(S, 'creating worktree', { executionId, projectPath, worktreeName });
      const worktree = await OpencodeV2.createWorktree(baseUrl, projectPath, worktreeName);
      logger.info(S, 'worktree created', { executionId, worktree });
      worktreeDir = worktree.directory;
      wtName = worktree.name;
      wtBranch = worktree.branch ?? null;
    }

    await prisma.taskExecution.update({
      where: { id: executionId },
      data: {
        status: 'RUNNING' as ExecutionStatus,
        worktreeName: wtName,
        worktreeBranch: wtBranch,
        worktreeDirectory: worktreeDir,
      },
    });

    const session = await OpencodeV2.createSessionInWorkspace(baseUrl, worktreeDir, {
      title: `执行任务链：${topicName}`,
      agent: 'build',
    });
    logger.info(S, 'session created', { executionId, sessionId: session.id });

    await prisma.taskExecution.update({
      where: { id: executionId },
      data: { sessionId: session.id },
    });

    await executeTasks(executionId, baseUrl, worktreeDir, session.id, maxConcurrency);
  } catch (err: any) {
    logger.error(S, 'runExecution error', { executionId, error: err.message });
    await prisma.taskExecution.update({
      where: { id: executionId },
      data: { status: 'FAILED' as ExecutionStatus },
    }).catch(() => {});
  }
}

/**
 * 递归执行任务 — 按 DAG 拓扑顺序批量处理。
 *
 * 每次调用处理一批任务（数量 = maxConcurrency），完成后递归调用自身处理下一批。
 * 批量模式的必要性：所有任务共享同一个 AI 会话，waitForSessionIdle 是全局等待，
 * 必须确保每批只有一个 wait 调用，否则多个并发 wait 会同时 resolve 导致竞态。
 */
async function executeTasks(
  executionId: string,
  baseUrl: string,
  directory: string,
  sessionId: string,
  maxConcurrency: number,
) {
  const execution = await prisma.taskExecution.findUnique({ where: { id: executionId } });
  if (!execution || execution.status === 'STOPPED' || execution.status === 'FAILED') return;

  const allTasks = await TaskService.listByTopic(execution.topicId);
  const available = getNextTasks(allTasks);
  const runningCount = allTasks.filter((t) => t.status === 'IN_PROGRESS').length;
  const toStart = available.slice(0, Math.max(0, maxConcurrency - runningCount));

  logger.info(S, 'executeTasks tick', {
    executionId,
    available: available.length,
    running: runningCount,
    toStart: toStart.length,
  });

  // 无可启动任务且无运行中任务 → 执行结束
  if (toStart.length === 0 && runningCount === 0) {
    const hasPending = allTasks.some((t) => t.status === 'PENDING');
    // 如果还有 PENDING 任务说明它们被阻塞了（依赖未能完成），标记为 FAILED
    const finalStatus = hasPending ? 'FAILED' as ExecutionStatus : 'COMPLETED' as ExecutionStatus;
    const completedCount = allTasks.filter((t) => t.status === 'COMPLETED').length;
    await prisma.taskExecution.update({
      where: { id: executionId },
      data: {
        status: finalStatus,
        completedTasks: completedCount,
        totalTasks: allTasks.length,
      },
    });
    logger.info(S, 'execution finished', { executionId, status: finalStatus, completedCount });
    return;
  }

  // 有运行中的任务但无可启动的 → 等待当前任务完成后再试
  if (toStart.length === 0) return;

  // 第一阶段：逐个发送 prompt 到 AI 会话
  for (const task of toStart) {
    const refreshed = await prisma.taskExecution.findUnique({ where: { id: executionId } });
    if (!refreshed || refreshed.status === 'STOPPED' || refreshed.status === 'FAILED') return;

    await TaskService.update(task.id, { status: 'IN_PROGRESS' });
    const deps = task.dependencies.map((id) => allTasks.find((t) => t.id === id)).filter(Boolean) as TaskWithDeps[];
    const prompt = buildPrompt(task, deps);

    logger.info(S, 'sending task prompt', { executionId, taskId: task.id, title: task.title });

    try {
      await OpencodeV2.sendPrompt(baseUrl, sessionId, prompt, directory);
    } catch (err: any) {
      logger.error(S, 'task prompt send error', { executionId, taskId: task.id, error: err.message });
      await TaskService.update(task.id, { status: 'BLOCKED' });
      executeTasks(executionId, baseUrl, directory, sessionId, maxConcurrency).catch((e) =>
        logger.error(S, 'executeTasks recursion error', e)
      );
      return;
    }
  }

  // 第二阶段：等待 AI 会话处理完本批所有任务
  // 等待 1 秒让 agent loop 拾取消息后再调用 wait，防止 session 本来就 idle 导致 wait 立即返回
  await new Promise((r) => setTimeout(r, 1000));
  logger.info(S, 'waiting for session idle', { executionId, batch: toStart.map((t) => t.id) });

  try {
    await OpencodeV2.waitForSessionIdle(baseUrl, sessionId, directory);
  } catch (err: any) {
    logger.error(S, 'waitForSessionIdle error', { executionId, error: err.message });
    // AI 处理失败，将本批任务标记为 BLOCKED，尝试继续下一批
    for (const task of toStart) {
      try {
        const check = await prisma.taskExecution.findUnique({ where: { id: executionId } });
        if (!check || check.status === 'STOPPED' || check.status === 'FAILED') return;
        await TaskService.update(task.id, { status: 'BLOCKED' });
      } catch {}
    }
    executeTasks(executionId, baseUrl, directory, sessionId, maxConcurrency).catch((e) =>
      logger.error(S, 'executeTasks recursion error', e)
    );
    return;
  }

  // 第三阶段：验证 AI 响应并标记任务完成
  // 原子检查：只有 execution 仍为 RUNNING 时才标记任务完成。
  // 防止 stop() 在 waitForSessionIdle 返回后、标记完成前将状态设为 STOPPED 导致竞态。
  const check = await prisma.taskExecution.findUnique({ where: { id: executionId } });
  if (!check || check.status !== 'RUNNING') {
    logger.info(S, 'execution no longer RUNNING, skip marking tasks', { executionId, status: check?.status });
    return;
  }

  // 逐任务验证：检查 session messages 确认每个 prompt 都得到了 AI 响应。
  // 简化策略：统计 assistant 消息数量是否 >= 本批任务数。
  // 如果 AI 跳过了某些任务，对应任务标记为 BLOCKED 而非 COMPLETED。
  let assistantCount = 0;
  try {
    const messages = await OpencodeV2.getSessionMessages(baseUrl, sessionId, directory);
    assistantCount = messages.filter((m: any) => m.role === 'assistant').length;
    logger.info(S, 'session messages check', { executionId, totalMessages: messages.length, assistantCount, batchSize: toStart.length });
  } catch (err: any) {
    logger.warn(S, 'getSessionMessages error, assuming all completed', { error: err.message });
    assistantCount = toStart.length;
  }

  const confirmedCount = Math.min(assistantCount, toStart.length);
  for (let i = 0; i < toStart.length; i++) {
    const task = toStart[i];
    // 如果 assistant 回复数量不足，后面的任务标记为 BLOCKED
    await TaskService.update(task.id, { status: i < confirmedCount ? 'COMPLETED' : 'BLOCKED' });
  }

  const allNow = await TaskService.listByTopic(execution.topicId);
  const completedCount = allNow.filter((t) => t.status === 'COMPLETED').length;
  // 只在仍是 RUNNING 时更新进度（stop 可能已经将其改为 STOPPED）
  await prisma.taskExecution.updateMany({
    where: { id: executionId, status: 'RUNNING' },
      data: { completedTasks: completedCount, totalTasks: allNow.length },
  });
  logger.info(S, 'batch completed', { executionId, tasks: toStart.map((t) => t.id), completedCount });

  executeTasks(executionId, baseUrl, directory, sessionId, maxConcurrency).catch((e) =>
    logger.error(S, 'executeTasks recursion error', e)
  );
}

// 停止执行：中止 AI 会话，将 IN_PROGRESS 任务重置为 PENDING 以便重新执行
export async function stop(executionId: string) {
  const execution = await prisma.taskExecution.findUnique({ where: { id: executionId } });
  if (!execution) throw new Error('Execution not found');
  if (execution.status !== 'RUNNING' && execution.status !== 'CREATING_WORKTREE') {
    throw new Error('Execution is not running');
  }

  if (execution.sessionId) {
    try {
      const baseUrl = await EngineService.getBaseUrl();
      // 优先使用 worktree 目录（session 绑定在 worktree 中），回退到项目路径
      const directory = execution.worktreeDirectory;
      if (directory) {
        await OpencodeV2.abortSession(baseUrl, execution.sessionId, directory);
      }
    } catch (err: any) {
      logger.warn(S, 'abort session error (ignored)', { error: err.message });
    }
  }

  await prisma.taskExecution.update({
    where: { id: executionId },
    data: { status: 'STOPPED' as ExecutionStatus },
  });

  // 重置 IN_PROGRESS 任务为 PENDING，允许用户重新执行
  const tasks = await TaskService.listByTopic(execution.topicId);
  for (const task of tasks) {
    if (task.status === 'IN_PROGRESS') {
      await TaskService.update(task.id, { status: 'PENDING' });
    }
  }

  return prisma.taskExecution.findUnique({ where: { id: executionId } });
}

// 合并操作：记录用户选择的目标分支，将执行状态标记为 MERGED。
// 注意：当前仅做状态标记，实际的 git merge 操作需要后续集成 git API 实现。
export async function merge(executionId: string, targetBranch: string) {
  const execution = await prisma.taskExecution.findUnique({ where: { id: executionId } });
  if (!execution) throw new Error('Execution not found');
  if (execution.status !== 'COMPLETED') throw new Error('Execution must be COMPLETED to merge');

  await prisma.taskExecution.update({
    where: { id: executionId },
    data: {
      status: 'MERGED' as ExecutionStatus,
      targetBranch,
    },
  });

  return prisma.taskExecution.findUnique({ where: { id: executionId } });
}

export async function getStatus(topicId: string) {
  return prisma.taskExecution.findFirst({
    where: { topicId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getByTopic(topicId: string) {
  return prisma.taskExecution.findMany({
    where: { topicId },
    orderBy: { createdAt: 'desc' },
  });
}
