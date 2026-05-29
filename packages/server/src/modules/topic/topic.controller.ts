import { Context } from 'koa';
import * as Service from './topic.service.js';
import { reqLogger } from '../../logger.js';

export async function list(ctx: Context) {
  const [topics, dependencies, orphanTasks] = await Promise.all([
    Service.listByProject(ctx.params.projectId),
    Service.deriveDependencies(ctx.params.projectId),
    Service.getOrphanTasks(ctx.params.projectId),
  ]);
  ctx.body = { topics, dependencies, orphanTasks };
}

export async function create(ctx: Context) {
  const { name, summary } = ctx.request.body as any;
  if (!name || typeof name !== 'string') {
    ctx.status = 400;
    ctx.body = { error: 'name is required' };
    return;
  }
  const topic = await Service.create(ctx.params.projectId, { name, summary });
  ctx.status = 201;
  ctx.body = topic;
}

export async function update(ctx: Context) {
  const { name, summary } = ctx.request.body as any;
  try {
    const topic = await Service.update(ctx.params.topicId, { name, summary });
    ctx.body = topic;
  } catch (err: any) {
    if (err.code === 'P2025') {
      ctx.status = 404;
      ctx.body = { error: 'Topic not found' };
      return;
    }
    throw err;
  }
}

export async function remove(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  try {
    await Service.remove(ctx.params.topicId);
    log.info('topic.ctrl', 'remove', { topicId: ctx.params.topicId });
    ctx.status = 204;
  } catch (err: any) {
    if (err.code === 'P2025') {
      ctx.status = 404;
      ctx.body = { error: 'Topic not found' };
      return;
    }
    throw err;
  }
}
