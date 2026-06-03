/**
 * 任务链执行控制器 — REST API 端点。
 *
 * 端点：
 *   POST   /api/topics/:topicId/executions          启动执行
 *   GET    /api/topics/:topicId/executions/latest    获取最新执行状态
 *   GET    /api/topics/:topicId/executions           列出所有执行
 *   POST   /api/executions/:executionId/stop         停止执行
 *   POST   /api/executions/:executionId/merge        合并到目标分支
 *
 * 注意：start 端点的 projectId 从 request body 获取（而非 ctx.params），
 * 因为路由前缀只包含 :topicId，projectId 由前端在 body 中传递。
 * 这里修复了之前的 bug：原来错误地从 ctx.params 提取 projectId 导致执行总是失败。
 */
import { Context } from 'koa';
import * as Service from './execution.service.js';
import { reqLogger } from '../../logger.js';

export async function start(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  const { topicId } = ctx.params;
  // projectId 和 maxConcurrency 都从 request body 获取。
  // 原来的实现错误地从 ctx.params 提取 projectId，但路由只有 :topicId 参数，
  // 导致 projectId 始终为 undefined，执行必定失败（"Project not found"）。
  const { projectId, maxConcurrency } = ctx.request.body as any || {};

  log.info('execution.ctrl', 'start', { topicId, projectId, maxConcurrency });

  try {
    const execution = await Service.start(topicId, projectId, maxConcurrency);
    ctx.status = 201;
    ctx.body = execution;
  } catch (err: any) {
    if (err.message?.includes('already running')) {
      ctx.status = 409;
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

export async function stop(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  const { executionId } = ctx.params;

  log.info('execution.ctrl', 'stop', { executionId });

  try {
    const execution = await Service.stop(executionId);
    ctx.body = execution;
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
    ctx.body = execution;
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
      ctx.body = { error: err.message };
      return;
    }
    throw err;
  }
}

export async function status(ctx: Context) {
  const { topicId } = ctx.params;
  const execution = await Service.getStatus(topicId);
  ctx.body = execution || null;
}

export async function list(ctx: Context) {
  const { topicId } = ctx.params;
  const executions = await Service.getByTopic(topicId);
  ctx.body = { data: executions };
}

export async function messages(ctx: Context) {
  const { executionId } = ctx.params;
  const msgs = await Service.getSessionMessages(executionId);
  ctx.body = { messages: msgs };
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
