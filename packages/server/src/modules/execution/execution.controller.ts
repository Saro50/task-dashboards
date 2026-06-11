/**
 * 任务链执行控制器 — REST API 端点。
 *
 * 端点：
 *   POST   /api/tasks/:taskId/executions             启动执行
 *   GET    /api/tasks/:taskId/executions/latest       获取最新执行状态
 *   GET    /api/tasks/:taskId/executions              列出所有执行
 *   POST   /api/executions/:executionId/stop          停止执行
 *   POST   /api/executions/:executionId/merge         合并到目标分支
 *   POST   /api/executions/:executionId/merge-force   强制合并（保留冲突 → CONFLICTING）
 *   POST   /api/executions/:executionId/resolve-conflict  确认冲突已解决
 *   POST   /api/executions/:executionId/abort-conflict    放弃冲突解决
 *   GET    /api/steps/:stepId/diff                    获取单个步骤的文件变更
 *
 * 注意：start 端点的 projectId 从 request body 获取（而非 ctx.params），
 * 因为路由前缀只包含 :taskId，projectId 由前端在 body 中传递。
 * 这里修复了之前的 bug：原来错误地从 ctx.params 提取 projectId 导致执行总是失败。
 */
import { Context } from 'koa';
import * as Service from './execution.service.js';
import { reqLogger } from '../../logger.js';

/**
 * 将 Prisma TaskExecution 记录序列化为 API 响应。
 * conflictFiles 在 DB 中以 JSON 字符串存储（String?），这里解析为 string[] | null。
 */
function formatExecution(execution: any) {
  if (!execution) return execution;
  const { conflictFiles, ...rest } = execution;
  return {
    ...rest,
    conflictFiles: conflictFiles ? JSON.parse(conflictFiles) : null,
  };
}

export async function start(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  const { taskId } = ctx.params;
  // projectId 和 maxConcurrency 都从 request body 获取。
  // 原来的实现错误地从 ctx.params 提取 projectId，但路由只有 :taskId 参数，
  // 导致 projectId 始终为 undefined，执行必定失败（"Project not found"）。
  const { projectId, maxConcurrency } = ctx.request.body as any || {};

  log.info('execution.ctrl', 'start', { taskId, projectId, maxConcurrency });

  try {
    const execution = await Service.start(taskId, projectId, maxConcurrency);
    ctx.status = 201;
    ctx.body = formatExecution(execution);
  } catch (err: any) {
    if (err.message?.includes('already running')) {
      ctx.status = 409;
      ctx.body = { error: err.message };
      return;
    }
    if (err.message?.includes('最大并发执行数') || err.message?.includes('max concurrent')) {
      ctx.status = 429;
      ctx.body = { error: err.message };
      return;
    }
    if (err.message?.includes('No pending')) {
      ctx.status = 400;
      ctx.body = { error: err.message };
      return;
    }
    throw err;
  }
}

/**
 * 重新执行 — 停止旧 execution、清理 worktree、重置步骤状态，创建全新 execution 重新执行。
 * projectId 和 maxConcurrency 从 request body 获取（与 start 一致）。
 * 错误处理与 start 相同：409（重复执行）、429（并发限制）、400（无待执行步骤）。
 */
export async function restart(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  const { taskId } = ctx.params;
  const { projectId, maxConcurrency } = ctx.request.body as any || {};

  log.info('execution.ctrl', 'restart', { taskId, projectId, maxConcurrency });

  try {
    const execution = await Service.restart(taskId, projectId, maxConcurrency);
    ctx.status = 201;
    ctx.body = formatExecution(execution);
  } catch (err: any) {
    if (err.message?.includes('already running')) {
      ctx.status = 409;
      ctx.body = { error: err.message };
      return;
    }
    if (err.message?.includes('最大并发执行数') || err.message?.includes('max concurrent')) {
      ctx.status = 429;
      ctx.body = { error: err.message };
      return;
    }
    if (err.message?.includes('No pending')) {
      ctx.status = 400;
      ctx.body = { error: err.message };
      return;
    }
    if (err.message?.includes('not found') || err.message?.includes('Task not found')) {
      ctx.status = 404;
      ctx.body = { error: err.message };
      return;
    }
    throw err;
  }
}

export async function stop(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  const { executionId } = ctx.params;

  log.info('execution.ctrl', 'stop', { executionId });

  try {
    const execution = await Service.stop(executionId);
    ctx.body = formatExecution(execution);
  } catch (err: any) {
    if (err.message?.includes('not found')) {
      ctx.status = 404;
      ctx.body = { error: err.message };
      return;
    }
    if (err.message?.includes('not running')) {
      ctx.status = 400;
      ctx.body = { error: err.message };
      return;
    }
    throw err;
  }
}

export async function merge(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  const { executionId } = ctx.params;
  const { targetBranch } = ctx.request.body as any || {};

  log.info('execution.ctrl', 'merge', { executionId, targetBranch });

  if (!targetBranch || typeof targetBranch !== 'string') {
    ctx.status = 400;
    ctx.body = { error: 'targetBranch is required' };
    return;
  }

  try {
    const execution = await Service.merge(executionId, targetBranch);
    ctx.body = formatExecution(execution);
  } catch (err: any) {
    if (err.message?.includes('not found')) {
      ctx.status = 404;
      ctx.body = { error: err.message };
      return;
    }
    if (err.message?.includes('must be COMPLETED')) {
      ctx.status = 400;
      ctx.body = { error: err.message };
      return;
    }
    if (err.message?.includes('合并冲突')) {
      ctx.status = 409;
      ctx.body = {
        error: err.message,
        conflictFiles: err.conflictFiles ?? [],
      };
      return;
    }
    throw err;
  }
}

export async function status(ctx: Context) {
  const { taskId } = ctx.params;
  const execution = await Service.getStatus(taskId);
  ctx.body = execution ? formatExecution(execution) : null;
}

export async function list(ctx: Context) {
  const { taskId } = ctx.params;
  const executions = await Service.getByTask(taskId);
  ctx.body = { data: executions.map(formatExecution) };
}

export async function messages(ctx: Context) {
  const { executionId } = ctx.params;
  const msgs = await Service.getSessionMessages(executionId);
  ctx.body = { messages: msgs };
}

export async function activeByProject(ctx: Context) {
  const { projectId } = ctx.params;
  const executions = await Service.getActiveByProject(projectId);
  ctx.body = { data: executions.map(formatExecution) };
}

export async function diff(ctx: Context) {
  const { executionId } = ctx.params;
  const diffs = await Service.getDiff(executionId);
  ctx.body = { diffs };
}

export async function branches(ctx: Context) {
  const { executionId } = ctx.params;
  try {
    const result = await Service.getBranches(executionId);
    ctx.body = result;
  } catch (err: any) {
    if (err.message?.includes('not found')) {
      ctx.status = 404;
      ctx.body = { error: err.message };
      return;
    }
    throw err;
  }
}

export async function stepDiff(ctx: Context) {
  const { stepId } = ctx.params;
  const executionId = ctx.query.executionId as string;

  if (!executionId) {
    ctx.status = 400;
    ctx.body = { error: 'executionId is required' };
    return;
  }

  try {
    const diffs = await Service.getStepDiff(stepId, executionId);
    ctx.body = { diffs };
  } catch (err: any) {
    if (err.message?.includes('not found')) {
      ctx.status = 404;
      ctx.body = { error: err.message };
      return;
    }
    throw err;
  }
}

export async function stepMessages(ctx: Context) {
  const { stepId } = ctx.params;
  const executionId = ctx.query.executionId as string;

  if (!executionId) {
    ctx.status = 400;
    ctx.body = { error: 'executionId is required' };
    return;
  }

  try {
    const result = await Service.getStepMessages(stepId, executionId);
    ctx.body = result;
  } catch (err: any) {
    if (err.message?.includes('not found')) {
      ctx.status = 404;
      ctx.body = { error: err.message };
      return;
    }
    throw err;
  }
}

/**
 * 强制合并 — 不在冲突时 abort，将执行推进到 CONFLICTING 状态。
 * 用于用户选择「手动解决冲突」的场景。
 */
export async function mergeForce(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  const { executionId } = ctx.params;
  const { targetBranch } = ctx.request.body as any || {};

  log.info('execution.ctrl', 'mergeForce', { executionId, targetBranch });

  if (!targetBranch || typeof targetBranch !== 'string') {
    ctx.status = 400;
    ctx.body = { error: 'targetBranch is required' };
    return;
  }

  try {
    const result = await Service.mergeForce(executionId, targetBranch);
    ctx.body = result;
  } catch (err: any) {
    if (err.message?.includes('not found')) {
      ctx.status = 404;
      ctx.body = { error: err.message };
      return;
    }
    if (err.message?.includes('must be COMPLETED')) {
      ctx.status = 400;
      ctx.body = { error: err.message };
      return;
    }
    throw err;
  }
}

/**
 * 确认冲突已解决 — 检查 git index，若已解决则完成合并。
 */
export async function resolveConflict(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  const { executionId } = ctx.params;

  log.info('execution.ctrl', 'resolveConflict', { executionId });

  try {
    const result = await Service.resolveConflict(executionId);
    ctx.body = result;
  } catch (err: any) {
    if (err.message?.includes('not found')) {
      ctx.status = 404;
      ctx.body = { error: err.message };
      return;
    }
    if (err.message?.includes('must be CONFLICTING')) {
      ctx.status = 400;
      ctx.body = { error: err.message };
      return;
    }
    throw err;
  }
}

/**
 * 放弃冲突解决 — abort merge，状态回退到 COMPLETED。
 */
export async function abortConflict(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  const { executionId } = ctx.params;

  log.info('execution.ctrl', 'abortConflict', { executionId });

  try {
    const execution = await Service.abortConflict(executionId);
    ctx.body = formatExecution(execution);
  } catch (err: any) {
    if (err.message?.includes('not found')) {
      ctx.status = 404;
      ctx.body = { error: err.message };
      return;
    }
    if (err.message?.includes('must be CONFLICTING')) {
      ctx.status = 400;
      ctx.body = { error: err.message };
      return;
    }
    throw err;
  }
}
