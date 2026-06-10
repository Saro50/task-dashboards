/**
 * 任务链执行服务 — 核心业务逻辑。
 *
 * 执行流程：
 *   start() → 创建 TaskExecution 记录 → 异步调用 runExecution()
 *   runExecution() → 创建 worktree → 记录初始 commitHash → 创建 AI 会话 → 调用 executeSteps()
 *   executeSteps() → 按 DAG 拓扑顺序逐个执行步骤（串行）：
 *     1. 找出所有依赖已满足的 PENDING 步骤，取第一个执行
 *     2. 发送 prompt → 等待 AI 响应
 *     3. COMPLETED → git commit 变更 → 记录 StepCommit → 递归执行下一个步骤
 *     4. BLOCKED → git reset 丢弃部分修改 → 递归执行下一个步骤（如有）
 *     5. 无更多步骤时将执行标记为 COMPLETED
 *
 * 单任务内固定串行执行，maxConcurrency 控制项目级多任务并发数。
 *
 * stop() → 中止 AI 会话 + 将 IN_PROGRESS 步骤重置为 PENDING
 * merge() → 将 worktree 分支 squash merge 到目标分支 → 删除 worktree
 */
import { ExecutionStatus } from '@prisma/client';
import prisma from '../../prisma.js';
import * as EngineService from '../engine/engine.service.js';
import * as OpencodeV2 from '../engine/opencode-v2.js';
import * as StepService from '../step/step.service.js';
import { logger } from '../../logger.js';
import { simpleGit } from 'simple-git';

const S = 'execution.service';

interface StepWithDeps {
  id: string;
  title: string;
  description: string;
  status: string;
  dependencies: string[];
}

// 构建发送给 AI 的步骤提示词，包含步骤描述和已完成的前置依赖信息，
// 让 AI 了解上下文，避免重复已完成的工作。
function buildPrompt(step: StepWithDeps, deps: StepWithDeps[], allSteps: StepWithDeps[]): string {
  const lines: string[] = [];

  const statusIcon = (s: string) => {
    if (s === 'COMPLETED') return '✅';
    if (s === 'IN_PROGRESS') return '🔄';
    if (s === 'BLOCKED') return '❌';
    return '⏳';
  };

  lines.push('当前任务链执行状态：');
  for (const t of allSteps) {
    const icon = statusIcon(t.status);
    const suffix = t.id === step.id ? '  ← 当前' : '';
    lines.push(`- ${icon} ${t.title} (${t.status})${suffix}`);
  }
  lines.push('');

  lines.push(`## 步骤：${step.title}`);
  if (step.description) lines.push(step.description);
  const validDeps = deps.filter((d) => d.status === 'COMPLETED');
  if (validDeps.length > 0) {
    lines.push('', '## 前置依赖（已完成）');
    for (const dep of validDeps) {
      lines.push(`- ${dep.title}：${dep.description || '无描述'}`);
    }
  }
  lines.push('', '请开始执行当前步骤，完成后简要说明做了什么。');
  return lines.join('\n');
}

// 获取下一批可执行的步骤：状态为 PENDING 且所有依赖都已完成。
// 这是 DAG 拓扑排序的核心逻辑。
function getNextSteps(steps: StepWithDeps[]): StepWithDeps[] {
  return steps.filter(
    (t) =>
      t.status === 'PENDING' &&
      t.dependencies.every((depId) => steps.find((t2) => t2.id === depId)?.status === 'COMPLETED'),
  );
}

export async function start(taskId: string, projectId: string, maxConcurrency: number = 2) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new Error('Task not found');

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || !project.path) throw new Error('Project not found or no path configured');

  // 防止同一任务重复启动执行
  const existing = await prisma.taskExecution.findFirst({
    where: { taskId, status: { in: ['CREATING_WORKTREE', 'RUNNING'] } },
  });
  if (existing) throw new Error('An execution is already running for this task');

  // 项目级多任务并发控制
  const runningCount = await prisma.taskExecution.count({
    where: { projectId, status: { in: ['CREATING_WORKTREE', 'RUNNING'] } },
  });
  if (runningCount >= maxConcurrency) {
    throw new Error(`已达到最大并发执行数 (${maxConcurrency})，请等待现有执行完成`);
  }

  const steps = await StepService.listByTask(taskId);
  const pendingSteps = steps.filter((t) => t.status === 'PENDING');
  if (pendingSteps.length === 0) throw new Error('No pending tasks to execute');

  // 查找可复用的 execution：STOPPED 或 FAILED 且有 worktree
  const reusable = await prisma.taskExecution.findFirst({
    where: {
      taskId,
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
        totalSteps: steps.length,
        completedSteps: steps.filter((t) => t.status === 'COMPLETED').length,
        sessionId: null,
      },
    });
    logger.info(S, 'reusing execution record', { executionId: execution.id, previousStatus: reusable.status });
  } else {
    execution = await prisma.taskExecution.create({
      data: {
        taskId,
        projectId,
        status: 'CREATING_WORKTREE' as ExecutionStatus,
        maxConcurrency,
        totalSteps: steps.length,
        completedSteps: 0,
      },
    });
  }

  const reuseWorktree = reusable ? {
    directory: reusable.worktreeDirectory!,
    branch: reusable.worktreeBranch,
    name: reusable.worktreeName,
  } : undefined;

  runExecution(execution.id, project.path, task.name, maxConcurrency, reuseWorktree).catch((err) => {
    logger.error(S, 'runExecution fatal error', err);
  });

  return execution;
}

// 创建 worktree 隔离环境 → 创建 AI 会话 → 开始执行步骤
async function runExecution(
  executionId: string,
  projectPath: string,
  taskName: string,
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
      const worktreeName = `exec-${taskName.slice(0, 16)}-${Date.now()}`;
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

    // 记录 worktree 初始 commitHash，作为第一个步骤 diff 的 parent
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
      title: `执行任务链：${taskName}`,
      agent: 'build',
    });
    logger.info(S, 'session created', { executionId, sessionId: session.id });

    await prisma.taskExecution.update({
      where: { id: executionId },
      data: { sessionId: session.id },
    });

    // 清理可能存在的旧 StepCommit 记录（重新执行场景）
    const deleted = await prisma.stepCommit.deleteMany({ where: { executionId } });
    if (deleted.count > 0) {
      logger.info(S, 'cleaned up old StepCommit records', { executionId, count: deleted.count });
    }

    await executeSteps(executionId, baseUrl, worktreeDir, session.id, maxConcurrency);
  } catch (err: any) {
    logger.error(S, 'runExecution error', { executionId, error: err.message });
    await prisma.taskExecution.update({
      where: { id: executionId },
      data: { status: 'FAILED' as ExecutionStatus },
    }).catch(() => {});
  }
}

/**
 * 递归执行步骤 — 按 DAG 拓扑顺序逐个串行处理。
 *
 * 每次调用处理 1 个步骤，完成后递归调用自身处理下一个。
 * 单任务内不支持并发，确保每个步骤完成后可以正确 commit 变更。
 */
async function executeSteps(
  executionId: string,
  baseUrl: string,
  directory: string,
  sessionId: string,
  maxConcurrency: number,
) {
  const execution = await prisma.taskExecution.findUnique({ where: { id: executionId } });
  if (!execution || execution.status === 'STOPPED' || execution.status === 'FAILED') return;

  const allSteps = await StepService.listByTask(execution.taskId);
  const available = getNextSteps(allSteps);
  const runningCount = allSteps.filter((t) => t.status === 'IN_PROGRESS').length;

  logger.info(S, 'executeSteps tick', {
    executionId,
    available: available.length,
    running: runningCount,
  });

  // 无可启动步骤且无运行中步骤 → 执行结束
  if (available.length === 0 && runningCount === 0) {
    const hasPending = allSteps.some((t) => t.status === 'PENDING');
    // 如果还有 PENDING 步骤说明它们被阻塞了（依赖未能完成），标记为 FAILED
    const finalStatus = hasPending ? 'FAILED' as ExecutionStatus : 'COMPLETED' as ExecutionStatus;
    const completedCount = allSteps.filter((t) => t.status === 'COMPLETED').length;
    await prisma.taskExecution.update({
      where: { id: executionId },
      data: {
        status: finalStatus,
        completedSteps: completedCount,
        totalSteps: allSteps.length,
      },
    });
    logger.info(S, 'execution finished', { executionId, status: finalStatus, completedCount });
    return;
  }

  // 有运行中的步骤但无可启动的 → 等待当前步骤完成后再试
  if (available.length === 0) return;

  // 串行模式：只取第一个可用步骤
  const step = available[0];

  // 检查执行状态是否已被中止
  const refreshed = await prisma.taskExecution.findUnique({ where: { id: executionId } });
  if (!refreshed || refreshed.status === 'STOPPED' || refreshed.status === 'FAILED') return;

  await StepService.update(step.id, { status: 'IN_PROGRESS' });
  const deps = step.dependencies.map((id) => allSteps.find((t) => t.id === id)).filter(Boolean) as StepWithDeps[];

  // 构造 prompt + 步骤完成标记
  // AI 被要求在完成时输出 <task-{id}>done</task-{id}>，
  // waitForAssistantText 通过搜索该标记判断步骤是否完成——
  // 比消息计数更可靠（不受 tool-call 中间消息数量影响）
  const stepMarker = `<task-${step.id}>done</task-${step.id}>`;
  const prompt = buildPrompt(step, deps, allSteps)
    + `\n\nWhen you have completed this task, include exactly the following marker in your response:\n${stepMarker}`;

  logger.info(S, 'sending step prompt', { executionId, stepId: step.id, title: step.title });

  try {
    await OpencodeV2.sendPrompt(baseUrl, sessionId, prompt, directory);
  } catch (err: any) {
    logger.error(S, 'step prompt send error', { executionId, stepId: step.id, error: err.message });
    await StepService.update(step.id, { status: 'BLOCKED', blockedReason: `发送步骤失败: ${err.message}` });
    // 丢弃可能的文件修改
    await resetWorktreeChanges(directory).catch((e) => logger.warn(S, 'resetWorktreeChanges error', { error: e.message }));
    executeSteps(executionId, baseUrl, directory, sessionId, maxConcurrency).catch((e) =>
      logger.error(S, 'executeSteps recursion error', e)
    );
    return;
  }

  // 两步串行等待：
  //   Step 1 waitForAssistantText: 等 AI 输出中包含步骤完成标记 <task-{id}>done</task-{id}>，
  //     证明 AI 已明确宣告完成（不依赖消息计数，避免 tool-call 中间消息干扰）
  //   Step 2 waitForSessionIdle: 阻塞到 session 真正空闲（所有 tool call 完成，AI 停止生成），
  //     确保 commitStepChanges 执行时 AI 创建的文件已全部落盘
  logger.info(S, 'waiting for AI step marker', { executionId, stepId: step.id });

  try {
    // Step 1: 等 AI 输出步骤完成标记
    await OpencodeV2.waitForAssistantText(baseUrl, sessionId, directory, stepMarker);
    // Step 2: 等 session 真正空闲（所有工具调用完成）
    await OpencodeV2.waitForSessionIdle(baseUrl, sessionId, directory);
  } catch (err: any) {
    logger.error(S, 'waitForAI error', { executionId, error: err.message });
    const check = await prisma.taskExecution.findUnique({ where: { id: executionId } });
    if (!check || check.status === 'STOPPED' || check.status === 'FAILED') return;
    await StepService.update(step.id, { status: 'BLOCKED', blockedReason: `AI 处理超时或失败: ${err.message}` });
    await resetWorktreeChanges(directory).catch((e) => logger.warn(S, 'resetWorktreeChanges error', { error: e.message }));
    executeSteps(executionId, baseUrl, directory, sessionId, maxConcurrency).catch((e) =>
      logger.error(S, 'executeSteps recursion error', e)
    );
    return;
  }

  // 验证执行状态（waitForAssistantText 已确认 AI 返回了完成标记，无需再检查消息数）
  const check = await prisma.taskExecution.findUnique({ where: { id: executionId } });
  if (!check || check.status !== 'RUNNING') {
    logger.info(S, 'execution no longer RUNNING, skip marking step', { executionId, status: check?.status });
    return;
  }

  // 先提交变更（创建 StepCommit 记录），再标记 COMPLETED
  // 确保 frontend 轮询看到 COMPLETED 时 diff 数据已就绪
  let tokenUsage = { input: 0, output: 0, cacheRead: 0 };
  try {
    const commitResult = await commitStepChanges(directory, step, executionId, execution.initialCommitHash, baseUrl, sessionId);
    tokenUsage = commitResult.tokenUsage;
  } catch (err: any) {
    logger.error(S, 'commitStepChanges error', { executionId, stepId: step.id, error: err.message });
  }
  await StepService.update(step.id, {
    status: 'COMPLETED',
    tokenInput: tokenUsage.input,
    tokenOutput: tokenUsage.output,
    cacheRead: tokenUsage.cacheRead,
  });

  const allNow = await StepService.listByTask(execution.taskId);
  const completedCount = allNow.filter((t) => t.status === 'COMPLETED').length;
  await prisma.taskExecution.updateMany({
    where: { id: executionId, status: 'RUNNING' },
    data: { completedSteps: completedCount, totalSteps: allNow.length },
  });
  logger.info(S, 'step completed', { executionId, stepId: step.id, status: 'COMPLETED', completedCount });

  executeSteps(executionId, baseUrl, directory, sessionId, maxConcurrency).catch((e) =>
    logger.error(S, 'executeSteps recursion error', e)
  );
}

/**
 * 在 worktree 中提交当前步骤的文件变更，并记录到 StepCommit 表。
 * 同时从 AI session 中提取该步骤的用户消息和 AI 回复，持久化到 userMessage / assistantMessage 字段，
 * 使 worktree 删除后仍可查看 AI 对话。
 * 无文件变更时仍创建 StepCommit 记录（commitHash = HEAD），确保消息不丢失。
 * 一个步骤可能产生多轮 assistant 消息（工具调用 → 结果 → 继续调用），
 * 所有轮次的 content 会被合并为一条 assistant message。
 *
 * @returns commitHash + 该步骤执行期间 AI 消耗的 token 统计
 */
async function commitStepChanges(
  worktreeDirectory: string,
  step: StepWithDeps,
  executionId: string,
  initialCommitHash: string | null,
  baseUrl: string,
  sessionId: string,
): Promise<{ commitHash: string | null; tokenUsage: { input: number; output: number; cacheRead: number } }> {
  const git = simpleGit(worktreeDirectory);
  const status = await git.status();
  const hasChanges = !status.isClean();

  let commitHash: string;
  let commitMessage: string;

  if (hasChanges) {
    commitMessage = `task: ${step.title}`;
    await git.raw(['add', '-A']);
    await git.commit(commitMessage);
    commitHash = await git.revparse(['HEAD']);
    logger.info(S, 'committed step changes', { stepId: step.id, commitHash, commitMessage });
  } else {
    commitHash = await git.revparse(['HEAD']);
    commitMessage = `task: ${step.title} (no changes)`;
    logger.info(S, 'commitStepChanges — no changes, recording HEAD', { stepId: step.id, commitHash });
  }

  // 查找 parentCommitHash：同 execution 下最新的 StepCommit，若无则用 initialCommitHash
  const prevCommit = await prisma.stepCommit.findFirst({
    where: { executionId },
    orderBy: { createdAt: 'desc' },
  });
  const parentCommitHash = prevCommit?.commitHash ?? initialCommitHash ?? commitHash;

  // 从 AI session 提取该步骤的全部消息
  // 一个步骤可能产生多轮 user→assistant 对话（工具调用产生中间 user 消息）
  let userMessage: any = null;
  let assistantMessage: any = null;
  /** 该步骤执行期间 assistant 消息累加的 token 消耗 */
  let tokenUsage = { input: 0, output: 0, cacheRead: 0 };
  try {
    const allMessages = await OpencodeV2.getSessionMessages(baseUrl, sessionId, worktreeDirectory);
    const marker = `## 步骤：${step.title}`;
    const promptIdx = allMessages.findIndex(
      (m: any) => m.type === 'user' && m.text?.includes(marker),
    );

    if (promptIdx !== -1) {
      userMessage = allMessages[promptIdx];

      // 收集 prompt 之后的所有 assistant 消息（可能多轮）
      const assistantMsgs = allMessages
        .slice(promptIdx + 1)
        .filter((m: any) => m.type === 'assistant');

      // ── 从 assistant 消息中累加 token 消耗 ──
      for (const m of assistantMsgs) {
        if (m.tokens) {
          tokenUsage.input += m.tokens.input || 0;
          tokenUsage.output += m.tokens.output || 0;
          tokenUsage.cacheRead += m.tokens.cache?.read || 0;
        }
      }

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
          // 兜底路径也提取 token
          const lastAssistant = allMessages[lastAssistantIdx];
          if (lastAssistant.tokens) {
            tokenUsage.input += lastAssistant.tokens.input || 0;
            tokenUsage.output += lastAssistant.tokens.output || 0;
            tokenUsage.cacheRead += lastAssistant.tokens.cache?.read || 0;
          }
        }
      }
    }
  } catch (err: any) {
    logger.warn(S, 'commitStepChanges — failed to fetch session messages', { stepId: step.id, error: err.message });
  }

  await prisma.stepCommit.create({
    data: {
      stepId: step.id,
      executionId,
      commitHash,
      parentCommitHash,
      commitMessage,
      userMessage,
      assistantMessage,
    },
  });

  return { commitHash, tokenUsage };
}

/**
 * 丢弃 worktree 中所有未提交的文件修改。
 * 用于 BLOCKED 步骤后清理 AI 产生的部分变更。
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

// 停止执行：中止 AI 会话，将 IN_PROGRESS 步骤重置为 PENDING 以便重新执行
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

  const steps = await StepService.listByTask(execution.taskId);
  for (const step of steps) {
    if (step.status === 'IN_PROGRESS') {
      await StepService.update(step.id, { status: 'PENDING' });
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
 *   任务链可能包含几十个步骤的改动，squash merge 将所有变更压缩为一个 commit，
 *   保持主分支历史整洁。commit message 以 task name 为前缀便于追溯。
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

  // 先在 worktree 目录中 commit 残留变更（BLOCKED 步骤等遗留的未提交修改）
  // per-step commit 已覆盖大部分变更，这里作为安全兜底
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
    const task = await prisma.task.findUnique({ where: { id: execution.taskId } });
    await git.commit(`feat: ${task?.name ?? '任务链'} 执行完成`);
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

export async function getStatus(taskId: string) {
  return prisma.taskExecution.findFirst({
    where: { taskId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getByTask(taskId: string) {
  return prisma.taskExecution.findMany({
    where: { taskId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * 获取项目下的执行列表（供 ExecutionPanel 全局面板使用）。
 *
 * 返回 CREATING_WORKTREE / RUNNING / COMPLETED / STOPPED 状态的执行。
 * FAILED / MERGED 状态不返回（失败和已合并的执行不展示在面板中）。
 * 按 taskId 精确查询应使用 getStatus(taskId)。
 */
export async function getActiveByProject(projectId: string) {
  return prisma.taskExecution.findMany({
    where: { projectId, status: { in: ['CREATING_WORKTREE', 'RUNNING', 'COMPLETED', 'STOPPED'] } },
    include: { task: { select: { id: true, name: true } } },
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
 * 获取单个步骤在指定执行中的文件变更 (diff)。
 * 通过 StepCommit 记录的 parentCommitHash → commitHash 计算两次 commit 之间的 diff。
 */
export async function getStepDiff(stepId: string, executionId: string) {
  const stepCommit = await prisma.stepCommit.findUnique({
    where: { stepId_executionId: { stepId, executionId } },
  });
  if (!stepCommit) return [];

  const execution = await prisma.taskExecution.findUnique({ where: { id: executionId } });
  if (!execution) throw new Error('Execution not found');

  const project = await prisma.project.findUnique({ where: { id: execution.projectId } });
  if (!project?.path) throw new Error('Project not found or no path configured');

  return getDiffBetweenCommits(
    stepCommit.parentCommitHash,
    stepCommit.commitHash,
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
 * 获取单个步骤在指定执行中的 AI 对话消息（用户 prompt + AI 回复）。
 *
 * 优先从 StepCommit.userMessage / assistantMessage 数据库字段读取（worktree 删除后仍可用）。
 * 兜底：从 opencode session 实时获取，通过 '## 步骤：{step.title}' 匹配定位。
 */
export async function getStepMessages(stepId: string, executionId: string) {
  // 优先从 DB 读取
  const stepCommit = await prisma.stepCommit.findUnique({
    where: { stepId_executionId: { stepId, executionId } },
  });
  if (stepCommit && (stepCommit.userMessage || stepCommit.assistantMessage)) {
    const messages: any[] = [];
    if (stepCommit.userMessage) messages.push(stepCommit.userMessage);
    if (stepCommit.assistantMessage) messages.push(stepCommit.assistantMessage);
    return { messages };
  }

  // 兜底：从 opencode session 实时获取
  const step = await prisma.step.findUnique({ where: { id: stepId } });
  if (!step) throw new Error('Step not found');

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
    logger.warn(S, 'getStepMessages — session fetch failed', { executionId, error: err.message });
    return { messages: [], unavailable: true };
  }

  const marker = `## 步骤：${step.title}`;
  const stepUserIdx = allMessages.findIndex(
    (m: any) => m.type === 'user' && m.text?.includes(marker),
  );
  if (stepUserIdx === -1) return { messages: [] };

  // 收集该步骤的所有消息：从 prompt 到下一个步骤 prompt（或 session 末尾）
  const result: any[] = [allMessages[stepUserIdx]];

  // 查找下一个步骤的 prompt 位置（以确定当前步骤的消息边界）
  const nextStepIdx = allMessages.findIndex(
    (m: any, i: number) =>
      i > stepUserIdx &&
      m.type === 'user' &&
      typeof m.text === 'string' &&
      m.text.includes('## 步骤：') &&
      !m.text.includes(marker),
  );
  const endIdx = nextStepIdx === -1 ? allMessages.length : nextStepIdx;

  // 收集区间内的所有 assistant 消息，合并为一条
  const assistantMsgs = allMessages
    .slice(stepUserIdx + 1, endIdx)
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
