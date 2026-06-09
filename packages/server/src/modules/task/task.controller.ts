import { Context } from 'koa';
import * as Service from './task.service.js';
import { reqLogger } from '../../logger.js';
import type { ImportTaskPlanRequest } from './types.js';

export async function list(ctx: Context) {
  const tasks = await Service.listByProject(ctx.params.projectId);
  ctx.body = { tasks };
}

export async function listByTopic(ctx: Context) {
  const tasks = await Service.listByTopic(ctx.params.topicId);
  ctx.body = { tasks };
}

export async function importTaskPlan(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  const body = ctx.request.body as ImportTaskPlanRequest;
  if (!body.tasks || !Array.isArray(body.tasks) || body.tasks.length === 0) {
    ctx.status = 400;
    ctx.body = { error: 'tasks must be a non-empty array' };
    return;
  }

  const refs = body.tasks.map((t) => t.ref);
  const uniqueRefs = new Set(refs);
  if (uniqueRefs.size !== refs.length) {
    ctx.status = 400;
    ctx.body = { error: 'task refs must be unique' };
    return;
  }

  for (const task of body.tasks) {
    if (!task.ref || !task.title) {
      ctx.status = 400;
      ctx.body = { error: 'each task must have ref and title' };
      return;
    }
    for (const dep of task.dependencies || []) {
      if (!uniqueRefs.has(dep)) {
        ctx.status = 400;
        ctx.body = { error: `dependency ref "${dep}" not found in tasks` };
        return;
      }
    }
  }

  try {
    const result = await Service.importPlan(ctx.params.projectId, body);
    log.info('task.ctrl', 'importTaskPlan', { count: result?.tasks?.length, planHash: result.planHash });
    ctx.status = 201;
    ctx.body = result;
  } catch (err: any) {
    if (err.code === 'PLAN_ALREADY_IMPORTED') {
      ctx.status = 409;
      ctx.body = { error: 'Plan already imported', existing: err.existing };
      return;
    }
    if (err.code === 'INVALID_REF_FORMAT') {
      ctx.status = 400;
      ctx.body = { error: err.message };
      return;
    }
    throw err;
  }
}

export async function createTask(ctx: Context) {
  const { id, title, description } = ctx.request.body as any;
  if (!title || typeof title !== 'string') {
    ctx.status = 400;
    ctx.body = { error: 'title is required' };
    return;
  }
  const task = await Service.create(ctx.params.projectId, { id, title, description });
  ctx.status = 201;
  ctx.body = task;
}

export async function updateTask(ctx: Context) {
  const { title, description, status, topicId, blockedReason } = ctx.request.body as any;
  if (status && !['PENDING', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED'].includes(status)) {
    ctx.status = 400;
    ctx.body = { error: 'status must be PENDING, IN_PROGRESS, COMPLETED or BLOCKED' };
    return;
  }
  try {
    const task = await Service.update(ctx.params.taskId, { title, description, status, blockedReason, topicId });
    ctx.body = task;
  } catch (err: any) {
    if (err.code === 'P2025') {
      ctx.status = 404;
      ctx.body = { error: 'Task not found' };
      return;
    }
    throw err;
  }
}

export async function deleteTask(ctx: Context) {
  try {
    await Service.remove(ctx.params.taskId);
    ctx.status = 204;
  } catch (err: any) {
    if (err.code === 'P2025') {
      ctx.status = 404;
      ctx.body = { error: 'Task not found' };
      return;
    }
    throw err;
  }
}

export async function addDependency(ctx: Context) {
  const { dependsOnId } = ctx.request.body as any;
  if (!dependsOnId) {
    ctx.status = 400;
    ctx.body = { error: 'dependsOnId is required' };
    return;
  }
  try {
    const dep = await Service.addDependency(ctx.params.taskId, dependsOnId);
    ctx.status = 201;
    ctx.body = dep;
  } catch (err: any) {
    if (err.code === 'P2002') {
      ctx.status = 409;
      ctx.body = { error: 'Dependency already exists' };
      return;
    }
    throw err;
  }
}

export async function removeDependency(ctx: Context) {
  try {
    await Service.removeDependency(ctx.params.taskId, ctx.params.depId);
    ctx.status = 204;
  } catch (err: any) {
    if (err.code === 'P2025') {
      ctx.status = 404;
      ctx.body = { error: 'Dependency not found' };
      return;
    }
    throw err;
  }
}

export async function listImportedPlans(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  const { sessionId } = ctx.params;
  log.info('task.ctrl', 'listImportedPlans', { sessionId });
  const plans = await Service.getImportedPlans(sessionId);
  ctx.body = plans;
}
