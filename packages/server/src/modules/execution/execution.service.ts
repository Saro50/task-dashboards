/**
 * 任务链执行服务 — 核心业务逻辑。
 *
 * 执行流程：
 *   start() → 创建 TaskExecution 记录 → 异步调用 runExecution()
 *   runExecution() → 创建 worktree → 记录初始 commitHash → 创建 AI 会话 → 调用 executeTasks()
 *   executeTasks() → 按 DAG 拓扑顺序逐个执行任务（串行）：
 *     1. 找出所有依赖已满足的 PENDING 任务，取第一个执行
 *     2. 发送 prompt → 等待 AI 响应
 *     3. COMPLETED → git commit 变更 → 记录 TaskCommit → 递归执行下一个任务
 *     4. BLOCKED → git reset 丢弃部分修改 → 递归执行下一个任务（如有）
 *     5. 无更多任务时将执行标记为 COMPLETED
 *
 * 单主题内固定串行执行，maxConcurrency 控制项目级多主题并发数。
 *
 * stop() → 中止 AI 会话 + 将 IN_PROGRESS 任务重置为 PENDING
 * merge() → 将 worktree 分支 squash merge 到目标分支 → 删除 worktree
 */
import { ExecutionStatus } from '@prisma/client';
import prisma from '../../prisma.js';
import * as EngineService from '../engine/engine.service.js';
import * as OpencodeV2 from '../engine/opencode-v2.js';
import * as TaskService from '../task/task.service.js';
import { logger } from '../../logger.js';
import { simpleGit } from 'simple-git';

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
function buildPrompt(task: TaskWithDeps, deps: TaskWithDeps[], allTasks: TaskWithDeps[]): string {
  const lines: string[] = [];

  const statusIcon = (s: string) => {
    if (s === 'COMPLETED') return '✅';
    if (s === 'IN_PROGRESS') return '🔄';
    if (s === 'BLOCKED') return '❌';
    return '⏳';
  };

  lines.push('当前任务链执行状态：');
  for (const t of allTasks) {
    const icon = statusIcon(t.status);
    const suffix = t.id === task.id ? '  ← 当前' : '';
    lines.push(`- ${icon} ${t.title} (${t.status})${suffix}`);
  }
  lines.push('');

  lines.push(`## 任务：${task.title}`);
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

  // 项目级多主题并发控制
  const runningCount = await prisma.taskExecution.count({
    where: { projectId, status: { in: ['CREATING_WORKTREE', 'RUNNING'] } },
  });
  if (runningCount >= maxConcurrency) {
    throw new Error(`已达到最大并发执行数 (${maxConcurrency})，请等待现有执行完成`);
  }

  const tasks = await TaskService.listByTopic(topicId);
  const pendingTasks = tasks.filter((t) => t.status === 'PENDING');
  if (pendingTasks.length === 0) throw new Error('No pending tasks to execute');

  // 查找可复用的 execution：STOPPED 或 FAILED 且有 worktree
  const reusable = await prisma.taskExecution.findFirst({
    where: {
      topicId,
      status: { in: ['STOPPED', 'FAILED'] },
      worktreeDirectory: { not: null },
    },
    orderBy: { createdAt: 'desc' },
  });

  let execution;
  if (reusable) {
    execution = await prisma.taskExecution.update({
      where: { id: reusable.id },
      data: {
        status: 'CREATING_WORKTREE' as ExecutionStatus,
        maxConcurrency,
        totalTasks: tasks.length,
        completedTasks: tasks.filter((t) => t.status === 'COMPLETED').length,
        sessionId: null,
      },
    });
    logger.info(S, 'reusing execution record', { executionId: execution.id, previousStatus: reusable.status });
  } else {
    execution = await prisma.taskExecution.create({
      data: {
        topicId,
        projectId,
        status: 'CREATING_WORKTREE' as ExecutionStatus,
        maxConcurrency,
        totalTasks: tasks.length,
        completedTasks: 0,
      },
    });
  }

  const reuseWorktree = reusable ? {
    directory: reusable.worktreeDirectory!,
    branch: reusable.worktreeBranch,
    name: reusable.worktreeName,
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

    // 记录 worktree 初始 commitHash，作为第一个任务 diff 的 parent
    let initialCommitHash: string | null = null;
    try {
      const worktreeGit = simpleGit(worktreeDir);
      initialCommitHash = await worktreeGit.revparse(['HEAD']);
      await prisma.taskExecution.update({
        where: { id: executionId },
        data: { initialCommitHash },
      });
      logger.info(S, 'recorded initial commit hash', { executionId, initialCommitHash });
    } catch (err: any) {
      logger.warn(S, 'failed to record initial commit hash', { executionId, error: err.message });
    }

    const session = await OpencodeV2.createSessionInWorkspace(baseUrl, worktreeDir, {
      title: `执行任务链：${topicName}`,
      agent: 'build',
    });
    logger.info(S, 'session created', { executionId, sessionId: session.id });

    await prisma.taskExecution.update({
      where: { id: executionId },
      data: { sessionId: session.id },
    });

    // 清理可能存在的旧 TaskCommit 记录（重新执行场景）
    const deleted = await prisma.taskCommit.deleteMany({ where: { executionId } });
    if (deleted.count > 0) {
      logger.info(S, 'cleaned up old TaskCommit records', { executionId, count: deleted.count });
    }

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
 * 递归执行任务 — 按 DAG 拓扑顺序逐个串行处理。
 *
 * 每次调用处理 1 个任务，完成后递归调用自身处理下一个。
 * 单主题内不支持并发，确保每个任务完成后可以正确 commit 变更。
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

  logger.info(S, 'executeTasks tick', {
    executionId,
    available: available.length,
    running: runningCount,
  });

  // 无可启动任务且无运行中任务 → 执行结束
  if (available.length === 0 && runningCount === 0) {
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
  if (available.length === 0) return;

  // 串行模式：只取第一个可用任务
  const task = available[0];

  // 检查执行状态是否已被中止
  const refreshed = await prisma.taskExecution.findUnique({ where: { id: executionId } });
  if (!refreshed || refreshed.status === 'STOPPED' || refreshed.status === 'FAILED') return;

  // 记录发送前的 assistant 消息数量
  let baseline = 0;
  try {
    const preMessages = await OpencodeV2.getSessionMessages(baseUrl, sessionId, directory);
    baseline = preMessages.filter((m: any) => m.type === 'assistant').length;
  } catch {}
  logger.info(S, 'baseline assistant count', { executionId, baseline });

  await TaskService.update(task.id, { status: 'IN_PROGRESS' });
  const deps = task.dependencies.map((id) => allTasks.find((t) => t.id === id)).filter(Boolean) as TaskWithDeps[];
  const prompt = buildPrompt(task, deps, allTasks);

  logger.info(S, 'sending task prompt', { executionId, taskId: task.id, title: task.title });

  try {
    await OpencodeV2.sendPrompt(baseUrl, sessionId, prompt, directory);
  } catch (err: any) {
    logger.error(S, 'task prompt send error', { executionId, taskId: task.id, error: err.message });
    await TaskService.update(task.id, { status: 'BLOCKED', blockedReason: `发送任务失败: ${err.message}` });
    // 丢弃可能的文件修改
    await resetWorktreeChanges(directory).catch((e) => logger.warn(S, 'resetWorktreeChanges error', { error: e.message }));
    executeTasks(executionId, baseUrl, directory, sessionId, maxConcurrency).catch((e) =>
      logger.error(S, 'executeTasks recursion error', e)
    );
    return;
  }

  // 等待 assistant 消息增长到 baseline + 1
  const targetCount = baseline + 1;
  logger.info(S, 'waiting for assistant message', { executionId, target: targetCount });

  try {
    await OpencodeV2.waitForAssistantMessages(baseUrl, sessionId, directory, targetCount);
  } catch (err: any) {
    logger.error(S, 'waitForAssistantMessages error', { executionId, error: err.message });
    const check = await prisma.taskExecution.findUnique({ where: { id: executionId } });
    if (!check || check.status === 'STOPPED' || check.status === 'FAILED') return;
    await TaskService.update(task.id, { status: 'BLOCKED', blockedReason: `AI 处理超时或失败: ${err.message}` });
    await resetWorktreeChanges(directory).catch((e) => logger.warn(S, 'resetWorktreeChanges error', { error: e.message }));
    executeTasks(executionId, baseUrl, directory, sessionId, maxConcurrency).catch((e) =>
      logger.error(S, 'executeTasks recursion error', e)
    );
    return;
  }

  // 验证 AI 响应并标记任务完成
  const check = await prisma.taskExecution.findUnique({ where: { id: executionId } });
  if (!check || check.status !== 'RUNNING') {
    logger.info(S, 'execution no longer RUNNING, skip marking task', { executionId, status: check?.status });
    return;
  }

  let assistantCount = 0;
  try {
    const messages = await OpencodeV2.getSessionMessages(baseUrl, sessionId, directory);
    assistantCount = messages.filter((m: any) => m.type === 'assistant').length;
    logger.info(S, 'session messages check', { executionId, assistantCount });
  } catch (err: any) {
    logger.warn(S, 'getSessionMessages error, assuming completed', { error: err.message });
    assistantCount = 1;
  }

  const isCompleted = assistantCount >= targetCount;

  if (isCompleted) {
    await TaskService.update(task.id, { status: 'COMPLETED' });

    // 提交变更并记录 TaskCommit
    try {
      await commitTaskChanges(directory, task, executionId, execution.initialCommitHash, baseUrl, sessionId);
    } catch (err: any) {
      logger.error(S, 'commitTaskChanges error', { executionId, taskId: task.id, error: err.message });
    }
  } else {
    await TaskService.update(task.id, {
      status: 'BLOCKED',
      blockedReason: `AI 未生成回复 (${assistantCount}/${targetCount})`,
    });
    // 丢弃 BLOCKED 任务的文件修改
    await resetWorktreeChanges(directory).catch((e) => logger.warn(S, 'resetWorktreeChanges error', { error: e.message }));
  }

  const allNow = await TaskService.listByTopic(execution.topicId);
  const completedCount = allNow.filter((t) => t.status === 'COMPLETED').length;
  await prisma.taskExecution.updateMany({
    where: { id: executionId, status: 'RUNNING' },
    data: { completedTasks: completedCount, totalTasks: allNow.length },
  });
  logger.info(S, 'task completed', { executionId, taskId: task.id, status: isCompleted ? 'COMPLETED' : 'BLOCKED', completedCount });

  executeTasks(executionId, baseUrl, directory, sessionId, maxConcurrency).catch((e) =>
    logger.error(S, 'executeTasks recursion error', e)
  );
}

/**
 * 在 worktree 中提交当前任务的文件变更，并记录到 TaskCommit 表。
 * 同时从 AI session 中提取该任务的用户消息和 AI 回复，持久化到 userMessage / assistantMessage 字段，
 * 使 worktree 删除后仍可查看 AI 对话。
 * 无文件变更时仍创建 TaskCommit 记录（commitHash = HEAD），确保消息不丢失。
 * 一个任务可能产生多轮 assistant 消息（工具调用 → 结果 → 继续调用），
 * 所有轮次的 content 会被合并为一条 assistant message。
 */
async function commitTaskChanges(
  worktreeDirectory: string,
  task: TaskWithDeps,
  executionId: string,
  initialCommitHash: string | null,
  baseUrl: string,
  sessionId: string,
): Promise<string | null> {
  const git = simpleGit(worktreeDirectory);
  const status = await git.status();
  const hasChanges = !status.isClean();

  let commitHash: string;
  let commitMessage: string;

  if (hasChanges) {
    commitMessage = `task: ${task.title}`;
    await git.raw(['add', '-A']);
    await git.commit(commitMessage);
    commitHash = await git.revparse(['HEAD']);
    logger.info(S, 'committed task changes', { taskId: task.id, commitHash, commitMessage });
  } else {
    commitHash = await git.revparse(['HEAD']);
    commitMessage = `task: ${task.title} (no changes)`;
    logger.info(S, 'commitTaskChanges — no changes, recording HEAD', { taskId: task.id, commitHash });
  }

  // 查找 parentCommitHash：同 execution 下最新的 TaskCommit，若无则用 initialCommitHash
  const prevCommit = await prisma.taskCommit.findFirst({
    where: { executionId },
    orderBy: { createdAt: 'desc' },
  });
  const parentCommitHash = prevCommit?.commitHash ?? initialCommitHash ?? commitHash;

  // 从 AI session 提取该任务的全部消息
  // 一个任务可能产生多轮 user→assistant 对话（工具调用产生中间 user 消息）
  let userMessage: any = null;
  let assistantMessage: any = null;
  try {
    const allMessages = await OpencodeV2.getSessionMessages(baseUrl, sessionId, worktreeDirectory);
    const marker = `## 任务：${task.title}`;
    const promptIdx = allMessages.findIndex(
      (m: any) => m.type === 'user' && m.text?.includes(marker),
    );

    if (promptIdx !== -1) {
      userMessage = allMessages[promptIdx];

      // 收集 prompt 之后的所有 assistant 消息（可能多轮）
      const assistantMsgs = allMessages
        .slice(promptIdx + 1)
        .filter((m: any) => m.type === 'assistant');

      if (assistantMsgs.length === 1) {
        assistantMessage = assistantMsgs[0];
      } else if (assistantMsgs.length > 1) {
        // 合并多轮 assistant 消息的 content 为一条
        const mergedContent = assistantMsgs.flatMap((m: any) => m.content ?? []);
        const last = assistantMsgs[assistantMsgs.length - 1];
        assistantMessage = {
          type: 'assistant',
          id: last.id,
          agent: last.agent ?? '',
          model: last.model ?? { id: '', providerID: '', variant: '' },
          content: mergedContent,
          finish: last.finish ?? 'stop',
          time: { created: assistantMsgs[0].time?.created ?? Date.now(), completed: last.time?.completed },
        };
      }
    } else {
      // 兜底：取最后一条 user + 最后一条 assistant
      const lastUserIdx = allMessages.map((m: any) => m.type).lastIndexOf('user');
      if (lastUserIdx !== -1) {
        userMessage = allMessages[lastUserIdx];
        const lastAssistantIdx = allMessages.map((m: any) => m.type).lastIndexOf('assistant');
        if (lastAssistantIdx !== -1 && lastAssistantIdx > lastUserIdx) {
          assistantMessage = allMessages[lastAssistantIdx];
        }
      }
    }
  } catch (err: any) {
    logger.warn(S, 'commitTaskChanges — failed to fetch session messages', { taskId: task.id, error: err.message });
  }

  await prisma.taskCommit.create({
    data: {
      taskId: task.id,
      executionId,
      commitHash,
      parentCommitHash,
      commitMessage,
      userMessage,
      assistantMessage,
    },
  });

  return commitHash;
}

/**
 * 丢弃 worktree 中所有未提交的文件修改。
 * 用于 BLOCKED 任务后清理 AI 产生的部分变更。
 */
async function resetWorktreeChanges(worktreeDirectory: string): Promise<void> {
  const git = simpleGit(worktreeDirectory);
  const status = await git.status();
  if (status.isClean()) return;
  logger.info(S, 'resetting worktree changes', { directory: worktreeDirectory, files: status.files.length });
  await git.checkout(['--', '.']);
  await git.clean('f', ['-d']);
  logger.info(S, 'worktree changes reset', { directory: worktreeDirectory });
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

  const tasks = await TaskService.listByTopic(execution.topicId);
  for (const task of tasks) {
    if (task.status === 'IN_PROGRESS') {
      await TaskService.update(task.id, { status: 'PENDING' });
    }
  }

  return prisma.taskExecution.findUnique({ where: { id: executionId } });
}

export async function getBranches(executionId: string) {
  const execution = await prisma.taskExecution.findUnique({ where: { id: executionId } });
  if (!execution) throw new Error('Execution not found');

  const project = await prisma.project.findUnique({ where: { id: execution.projectId } });
  if (!project?.path) throw new Error('Project not found or no path configured');

  const git = simpleGit(project.path);
  const result = await git.branch();
  const current = result.current;

  const branches = result.all.filter((b) => !b.startsWith('opencode/'));

  return { branches, current };
}

export async function getDiff(executionId: string) {
  const execution = await prisma.taskExecution.findUnique({ where: { id: executionId } });
  if (!execution) throw new Error('Execution not found');
  if (!execution.worktreeDirectory) throw new Error('No worktree for this execution');

  const baseUrl = await EngineService.getBaseUrl();
  return OpencodeV2.getDiff(baseUrl, execution.worktreeDirectory, 'branch');
}

/**
 * 合并执行 — 将 worktree 中的代码变更 squash merge 到用户选择的目标分支。
 *
 * ┌────────────────────────────────────────────────────────────────────┐
 * │ 完整步骤：                                                          │
 * │ 1. 校验：execution 必须 COMPLETED，且有 worktreeBranch/Directory    │
 * │ 2. worktree commit：opencode 不自动 commit，需手动 git add -A +     │
 * │    commit 将 AI 修改的文件提交到 worktree 分支                       │
 * │ 3. 主仓库 checkout targetBranch                                     │
 * │ 4. squash merge：git merge --squash worktreeBranch                  │
 * │    - 冲突则 abort 并抛错                                             │
 * │    - 无实际变更则跳过 commit（幂等）                                  │
 * │ 5. 清理：删除 worktree（失败仅 warn，不阻断合并结果）                 │
 * │ 6. 更新数据库：status → MERGED，记录 targetBranch                    │
 * └────────────────────────────────────────────────────────────────────┘
 *
 * 为什么用 squash merge 而非普通 merge：
 *   任务链可能包含几十个任务的改动，squash merge 将所有变更压缩为一个 commit，
 *   保持主分支历史整洁。commit message 以 topic name 为前缀便于追溯。
 */
export async function merge(executionId: string, targetBranch: string) {
  const execution = await prisma.taskExecution.findUnique({ where: { id: executionId } });
  if (!execution) throw new Error('Execution not found');
  if (execution.status !== 'COMPLETED') throw new Error('Execution must be COMPLETED to merge');
  if (!execution.worktreeBranch) throw new Error('No worktree branch for this execution');
  if (!execution.worktreeDirectory) throw new Error('No worktree directory for this execution');

  const project = await prisma.project.findUnique({ where: { id: execution.projectId } });
  if (!project?.path) throw new Error('Project not found or no path configured');

  const baseUrl = await EngineService.getBaseUrl();

  // 先在 worktree 目录中 commit 残留变更（BLOCKED 任务等遗留的未提交修改）
  // per-task commit 已覆盖大部分变更，这里作为安全兜底
  const worktreeGit = simpleGit(execution.worktreeDirectory);
  const status = await worktreeGit.status();
  if (!status.isClean()) {
    await worktreeGit.raw(['add', '-A']);
    await worktreeGit.commit('chore: residual worktree changes');
    logger.info(S, 'committed residual worktree changes', { executionId, branch: execution.worktreeBranch });
  }

  const git = simpleGit(project.path);
  await git.checkout(targetBranch);

  try {
    await git.merge(['--squash', execution.worktreeBranch]);
  } catch (err: any) {
    await git.merge(['--abort']).catch(() => {});
    throw new Error(`合并冲突: ${err.message}`);
  }

  // 检查 squash merge 后是否有实际变更
  const mergeStatus = await git.status();
  if (mergeStatus.staged.length > 0 || !mergeStatus.isClean()) {
    const topic = await prisma.taskTopic.findUnique({ where: { id: execution.topicId } });
    await git.commit(`feat: ${topic?.name ?? '任务链'} 执行完成`);
  } else {
    logger.info(S, 'no changes to commit after squash merge', { executionId });
  }

  try {
    await OpencodeV2.removeWorktree(baseUrl, project.path, execution.worktreeDirectory);
  } catch (err: any) {
    logger.warn(S, 'worktree removal error after merge', { executionId, error: err.message });
  }

  await prisma.taskExecution.update({
    where: { id: executionId },
    data: { status: 'MERGED' as ExecutionStatus, targetBranch },
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

/**
 * 获取项目下的执行列表（供 ExecutionPanel 全局面板使用）。
 *
 * 返回 CREATING_WORKTREE / RUNNING / COMPLETED / STOPPED 状态的执行。
 * FAILED / MERGED 状态不返回（失败和已合并的执行不展示在面板中）。
 * 按 topicId 精确查询应使用 getStatus(topicId)。
 */
export async function getActiveByProject(projectId: string) {
  return prisma.taskExecution.findMany({
    where: { projectId, status: { in: ['CREATING_WORKTREE', 'RUNNING', 'COMPLETED', 'STOPPED'] } },
    include: { topic: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getSessionMessages(executionId: string) {
  const execution = await prisma.taskExecution.findUnique({ where: { id: executionId } });
  if (!execution) throw new Error('Execution not found');
  if (!execution.sessionId || !execution.worktreeDirectory) return [];
  const baseUrl = await EngineService.getBaseUrl();
  return OpencodeV2.getSessionMessages(baseUrl, execution.sessionId, execution.worktreeDirectory);
}

/**
 * 获取单个任务在指定执行中的文件变更 (diff)。
 * 通过 TaskCommit 记录的 parentCommitHash → commitHash 计算两次 commit 之间的 diff。
 */
export async function getTaskDiff(taskId: string, executionId: string) {
  const taskCommit = await prisma.taskCommit.findUnique({
    where: { taskId_executionId: { taskId, executionId } },
  });
  if (!taskCommit) return [];

  const execution = await prisma.taskExecution.findUnique({ where: { id: executionId } });
  if (!execution) throw new Error('Execution not found');

  const project = await prisma.project.findUnique({ where: { id: execution.projectId } });
  if (!project?.path) throw new Error('Project not found or no path configured');

  return getDiffBetweenCommits(
    taskCommit.parentCommitHash,
    taskCommit.commitHash,
    execution.worktreeDirectory,
    project.path,
  );
}

/**
 * 统一的 diff 获取方法 — 兼容 worktree 存在和已删除两种场景。
 * 优先使用 worktree 目录查询；若 worktree 不存在则回退到主仓库。
 */
async function getDiffBetweenCommits(
  parentHash: string,
  childHash: string,
  worktreeDir: string | null,
  mainRepoDir: string,
): Promise<any[]> {
  // 尝试使用 worktree 目录
  if (worktreeDir) {
    try {
      const git = simpleGit(worktreeDir);
      const diffSummary = await git.diffSummary([`${parentHash}..${childHash}`]);
      if (diffSummary.files.length > 0 || diffSummary.insertions > 0 || diffSummary.deletions > 0) {
        return parseDiffSummary(git, parentHash, childHash, diffSummary);
      }
    } catch (err: any) {
      logger.warn(S, 'getDiffBetweenCommits — worktree failed, falling back to main repo', {
        worktreeDir, error: err.message,
      });
    }
  }

  // 回退到主仓库
  try {
    const git = simpleGit(mainRepoDir);
    const diffSummary = await git.diffSummary([`${parentHash}..${childHash}`]);
    return parseDiffSummary(git, parentHash, childHash, diffSummary);
  } catch (err: any) {
    logger.error(S, 'getDiffBetweenCommits — main repo failed', { mainRepoDir, error: err.message });
    return [];
  }
}

/**
 * 将 simple-git 的 DiffResult 解析为 FileDiff[] 格式（与 opencode VCS diff 兼容）。
 */
async function parseDiffSummary(
  git: ReturnType<typeof simpleGit>,
  parentHash: string,
  childHash: string,
  diffSummary: any,
): Promise<any[]> {
  const files: any[] = [];
  for (const f of diffSummary.files) {
    let patch: string | undefined;
    try {
      patch = await git.diff([`${parentHash}..${childHash}`, '--', f.file]);
    } catch {}

    let status: 'added' | 'deleted' | 'modified' = 'modified';
    try {
      // 检查文件在 parent 中是否存在，判断 added/deleted/modified
      await git.show([`${parentHash}:${f.file}`]);
    } catch {
      status = 'added';
    }
    if (status !== 'added') {
      try {
        await git.show([`${childHash}:${f.file}`]);
      } catch {
        status = 'deleted';
      }
    }

    files.push({
      file: f.file,
      additions: f.insertions ?? 0,
      deletions: f.deletions ?? 0,
      status,
      patch,
    });
  }
  return files;
}

/**
 * 获取单个任务在指定执行中的 AI 对话消息（用户 prompt + AI 回复）。
 *
 * 优先从 TaskCommit.userMessage / assistantMessage 数据库字段读取（worktree 删除后仍可用）。
 * 兜底：从 opencode session 实时获取，通过 '## 任务：{task.title}' 匹配定位。
 */
export async function getTaskMessages(taskId: string, executionId: string) {
  // 优先从 DB 读取
  const taskCommit = await prisma.taskCommit.findUnique({
    where: { taskId_executionId: { taskId, executionId } },
  });
  if (taskCommit && (taskCommit.userMessage || taskCommit.assistantMessage)) {
    const messages: any[] = [];
    if (taskCommit.userMessage) messages.push(taskCommit.userMessage);
    if (taskCommit.assistantMessage) messages.push(taskCommit.assistantMessage);
    return { messages };
  }

  // 兜底：从 opencode session 实时获取
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new Error('Task not found');

  const execution = await prisma.taskExecution.findUnique({ where: { id: executionId } });
  if (!execution) throw new Error('Execution not found');

  if (!execution.sessionId || !execution.worktreeDirectory) {
    return { messages: [], unavailable: true };
  }

  let allMessages: any[];
  try {
    const baseUrl = await EngineService.getBaseUrl();
    allMessages = await OpencodeV2.getSessionMessages(
      baseUrl,
      execution.sessionId,
      execution.worktreeDirectory,
    );
  } catch (err: any) {
    logger.warn(S, 'getTaskMessages — session fetch failed', { executionId, error: err.message });
    return { messages: [], unavailable: true };
  }

  const marker = `## 任务：${task.title}`;
  const taskUserIdx = allMessages.findIndex(
    (m: any) => m.type === 'user' && m.text?.includes(marker),
  );
  if (taskUserIdx === -1) return { messages: [] };

  // 收集该任务的所有消息：从 prompt 到下一个任务 prompt（或 session 末尾）
  const result: any[] = [allMessages[taskUserIdx]];

  // 查找下一个任务的 prompt 位置（以确定当前任务的消息边界）
  const nextTaskIdx = allMessages.findIndex(
    (m: any, i: number) =>
      i > taskUserIdx &&
      m.type === 'user' &&
      typeof m.text === 'string' &&
      m.text.includes('## 任务：') &&
      !m.text.includes(marker),
  );
  const endIdx = nextTaskIdx === -1 ? allMessages.length : nextTaskIdx;

  // 收集区间内的所有 assistant 消息，合并为一条
  const assistantMsgs = allMessages
    .slice(taskUserIdx + 1, endIdx)
    .filter((m: any) => m.type === 'assistant');

  if (assistantMsgs.length === 1) {
    result.push(assistantMsgs[0]);
  } else if (assistantMsgs.length > 1) {
    const mergedContent = assistantMsgs.flatMap((m: any) => m.content ?? []);
    const last = assistantMsgs[assistantMsgs.length - 1];
    result.push({
      type: 'assistant',
      id: last.id,
      agent: last.agent ?? '',
      model: last.model ?? { id: '', providerID: '', variant: '' },
      content: mergedContent,
      finish: last.finish ?? 'stop',
      time: { created: assistantMsgs[0].time?.created ?? Date.now(), completed: last.time?.completed },
    });
  }

  return { messages: result };
}
