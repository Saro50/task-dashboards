import { Context } from 'koa';
import * as Service from './project.service';

export async function list(ctx: Context) {
  ctx.body = await Service.list();
}

export async function getById(ctx: Context) {
  const project = await Service.getById(ctx.params.id);
  if (!project) {
    ctx.status = 404;
    ctx.body = { error: 'Project not found' };
    return;
  }
  ctx.body = project;
}

export async function create(ctx: Context) {
  const { name, description, path, readme } = ctx.request.body as any;
  if (!name || typeof name !== 'string') {
    ctx.status = 400;
    ctx.body = { error: 'name is required' };
    return;
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    ctx.status = 400;
    ctx.body = { error: 'name must contain only letters, numbers, hyphens and underscores' };
    return;
  }
  try {
    const project = await Service.create({ name, description, path, readme });
    ctx.status = 201;
    ctx.body = project;
  } catch (err: any) {
    if (err.code === 'P2002') {
      ctx.status = 409;
      ctx.body = { error: 'Project name already exists' };
      return;
    }
    throw err;
  }
}

export async function update(ctx: Context) {
  const { name, description, path, readme, status } = ctx.request.body as any;
  if (name !== undefined && !/^[a-zA-Z0-9_-]+$/.test(name)) {
    ctx.status = 400;
    ctx.body = { error: 'name must contain only letters, numbers, hyphens and underscores' };
    return;
  }
  try {
    const project = await Service.update(ctx.params.id, { name, description, path, readme, status });
    ctx.body = project;
  } catch (err: any) {
    if (err.code === 'P2025') {
      ctx.status = 404;
      ctx.body = { error: 'Project not found' };
      return;
    }
    if (err.code === 'P2002') {
      ctx.status = 409;
      ctx.body = { error: 'Project name already exists' };
      return;
    }
    throw err;
  }
}

export async function remove(ctx: Context) {
  try {
    await Service.remove(ctx.params.id);
    ctx.status = 204;
  } catch (err: any) {
    if (err.code === 'P2025') {
      ctx.status = 404;
      ctx.body = { error: 'Project not found' };
      return;
    }
    throw err;
  }
}

export async function updateStatus(ctx: Context) {
  const { status } = ctx.request.body as any;
  if (!status || !['ACTIVE', 'ARCHIVED'].includes(status)) {
    ctx.status = 400;
    ctx.body = { error: 'status must be ACTIVE or ARCHIVED' };
    return;
  }
  try {
    const project = await Service.update(ctx.params.id, { status });
    ctx.body = project;
  } catch (err: any) {
    if (err.code === 'P2025') {
      ctx.status = 404;
      ctx.body = { error: 'Project not found' };
      return;
    }
    throw err;
  }
}
