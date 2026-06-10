import { Context } from 'koa';
import * as Service from './task.service.js';
import { reqLogger } from '../../logger.js';

export async function list(ctx: Context) {
  const [tasks, dependencies, orphanSteps] = await Promise.all([
    Service.listByProject(ctx.params.projectId),
    Service.deriveDependencies(ctx.params.projectId),
    Service.getOrphanSteps(ctx.params.projectId),
  ]);
  ctx.body = { tasks, dependencies, orphanSteps };
}

export async function create(ctx: Context) {
  const { name, summary } = ctx.request.body as any;
  if (!name || typeof name !== 'string') {
    ctx.status = 400;
    ctx.body = { error: 'name is required' };
    return;
  }
  const task = await Service.create(ctx.params.projectId, { name, summary });
  ctx.status = 201;
  ctx.body = task;
}

export async function update(ctx: Context) {
  const { name, summary } = ctx.request.body as any;
  try {
    const task = await Service.update(ctx.params.taskId, { name, summary });
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

export async function remove(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  try {
    await Service.remove(ctx.params.taskId);
    log.info('task.ctrl', 'remove', { taskId: ctx.params.taskId });
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
