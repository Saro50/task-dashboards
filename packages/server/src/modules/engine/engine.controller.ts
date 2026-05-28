import { Context } from 'koa';
import * as Service from './engine.service';
import * as Opencode from './opencode';

export async function getConfig(ctx: Context) {
  const config = await Service.get();
  if (!config) {
    ctx.status = 404;
    ctx.body = { error: 'Engine config not found' };
    return;
  }
  ctx.body = config;
}

export async function upsertConfig(ctx: Context) {
  const { baseUrl } = ctx.request.body as any;
  if (!baseUrl || typeof baseUrl !== 'string') {
    ctx.status = 400;
    ctx.body = { error: 'baseUrl is required' };
    return;
  }
  try {
    new URL(baseUrl);
  } catch {
    ctx.status = 400;
    ctx.body = { error: 'baseUrl must be a valid URL' };
    return;
  }
  const config = await Service.upsert({ baseUrl });
  ctx.body = config;
}

export async function removeConfig(ctx: Context) {
  try {
    await Service.remove();
    ctx.status = 204;
  } catch (err: any) {
    if (err.code === 'P2025') {
      ctx.status = 404;
      ctx.body = { error: 'Engine config not found' };
      return;
    }
    throw err;
  }
}

export async function healthCheck(ctx: Context) {
  try {
    const baseUrl = await Service.getBaseUrl();
    const result = await Opencode.healthCheck(baseUrl);
    ctx.body = result.data;
  } catch (err: any) {
    ctx.status = 502;
    ctx.body = { error: 'Failed to connect to opencode server', detail: err.message };
  }
}

export async function listAgents(ctx: Context) {
  try {
    const baseUrl = await Service.getBaseUrl();
    const result = await Opencode.listAgents(baseUrl);
    ctx.body = result.data;
  } catch (err: any) {
    ctx.status = 502;
    ctx.body = { error: 'Failed to fetch agents', detail: err.message };
  }
}

export async function listProviders(ctx: Context) {
  try {
    const baseUrl = await Service.getBaseUrl();
    const result = await Opencode.listProviders(baseUrl);
    ctx.body = result.data;
  } catch (err: any) {
    ctx.status = 502;
    ctx.body = { error: 'Failed to fetch providers', detail: err.message };
  }
}

export async function getOpencodeConfig(ctx: Context) {
  try {
    const baseUrl = await Service.getBaseUrl();
    const result = await Opencode.getConfig(baseUrl);
    ctx.body = result.data;
  } catch (err: any) {
    ctx.status = 502;
    ctx.body = { error: 'Failed to fetch opencode config', detail: err.message };
  }
}
