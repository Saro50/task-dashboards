import { Context } from 'koa';
import * as Service from './step.service.js';
import { reqLogger } from '../../logger.js';
import type { ImportStepPlanRequest } from './types.js';

export async function list(ctx: Context) {
  const steps = await Service.listByProject(ctx.params.projectId);
  ctx.body = { steps };
}

export async function listByTask(ctx: Context) {
  const steps = await Service.listByTask(ctx.params.taskId);
  ctx.body = { steps };
}

export async function importStepPlan(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  const body = ctx.request.body as ImportStepPlanRequest;
  if (!body.steps || !Array.isArray(body.steps) || body.steps.length === 0) {
    ctx.status = 400;
    ctx.body = { error: 'steps must be a non-empty array' };
    return;
  }

  const refs = body.steps.map((s) => s.ref);
  const uniqueRefs = new Set(refs);
  if (uniqueRefs.size !== refs.length) {
    ctx.status = 400;
    ctx.body = { error: 'step refs must be unique' };
    return;
  }

  for (const step of body.steps) {
    if (!step.ref || !step.title) {
      ctx.status = 400;
      ctx.body = { error: 'each step must have ref and title' };
      return;
    }
    for (const dep of step.dependencies || []) {
      if (!uniqueRefs.has(dep)) {
        ctx.status = 400;
        ctx.body = { error: `dependency ref "${dep}" not found in steps` };
        return;
      }
    }
  }

  try {
    const result = await Service.importPlan(ctx.params.projectId, body);
    log.info('step.ctrl', 'importStepPlan', { count: result?.steps?.length, planHash: result.planHash });
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

export async function createStep(ctx: Context) {
  const { id, title, description } = ctx.request.body as any;
  if (!title || typeof title !== 'string') {
    ctx.status = 400;
    ctx.body = { error: 'title is required' };
    return;
  }
  const step = await Service.create(ctx.params.projectId, { id, title, description });
  ctx.status = 201;
  ctx.body = step;
}

export async function updateStep(ctx: Context) {
  const { title, description, status, taskId, blockedReason } = ctx.request.body as any;
  if (status && !['PENDING', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED'].includes(status)) {
    ctx.status = 400;
    ctx.body = { error: 'status must be PENDING, IN_PROGRESS, COMPLETED or BLOCKED' };
    return;
  }
  try {
    const step = await Service.update(ctx.params.stepId, { title, description, status, blockedReason, taskId });
    ctx.body = step;
  } catch (err: any) {
    if (err.code === 'P2025') {
      ctx.status = 404;
      ctx.body = { error: 'Step not found' };
      return;
    }
    throw err;
  }
}

export async function deleteStep(ctx: Context) {
  try {
    await Service.remove(ctx.params.stepId);
    ctx.status = 204;
  } catch (err: any) {
    if (err.code === 'P2025') {
      ctx.status = 404;
      ctx.body = { error: 'Step not found' };
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
    const dep = await Service.addDependency(ctx.params.stepId, dependsOnId);
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
    await Service.removeDependency(ctx.params.stepId, ctx.params.depId);
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
  log.info('step.ctrl', 'listImportedPlans', { sessionId });
  const plans = await Service.getImportedPlans(sessionId);
  ctx.body = plans;
}
