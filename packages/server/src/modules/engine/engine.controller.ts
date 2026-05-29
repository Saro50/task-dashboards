import { Context } from 'koa';
import * as Service from './engine.service.js';
import * as Opencode from './opencode.js';
import { reqLogger } from '../../logger.js';

export async function getConfig(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  const config = await Service.get();
  if (!config) {
    log.info('engine.ctrl', 'getConfig not found');
    ctx.status = 404;
    ctx.body = { error: 'Engine config not found' };
    return;
  }
  ctx.body = config;
}

export async function upsertConfig(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
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
  log.info('engine.ctrl', 'upsertConfig', { baseUrl });
  ctx.body = config;
}

export async function removeConfig(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  try {
    await Service.remove();
    log.info('engine.ctrl', 'removeConfig');
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
  const log = reqLogger(ctx.state.requestId);
  try {
    const baseUrl = await Service.getBaseUrl();
    await Opencode.healthCheck(baseUrl);
    log.info('engine.ctrl', 'healthCheck ok');
    ctx.body = { healthy: true };
  } catch (err: any) {
    log.error('engine.ctrl', 'healthCheck error', err.message);
    ctx.status = 502;
    ctx.body = { error: 'Failed to connect to opencode server', detail: err.message };
  }
}

export async function listAgents(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  try {
    const baseUrl = await Service.getBaseUrl();
    const result = await Opencode.listAgents(baseUrl);
    log.info('engine.ctrl', 'listAgents', { count: result.data?.length });
    ctx.body = result.data;
  } catch (err: any) {
    log.error('engine.ctrl', 'listAgents error', err.message);
    ctx.status = 502;
    ctx.body = { error: 'Failed to fetch agents', detail: err.message };
  }
}

export async function listProviders(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  try {
    const baseUrl = await Service.getBaseUrl();
    const result = await Opencode.listProviders(baseUrl);
    log.info('engine.ctrl', 'listProviders');
    ctx.body = result.data;
  } catch (err: any) {
    log.error('engine.ctrl', 'listProviders error', err.message);
    ctx.status = 502;
    ctx.body = { error: 'Failed to fetch providers', detail: err.message };
  }
}

export async function getOpencodeConfig(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  try {
    const baseUrl = await Service.getBaseUrl();
    const result = await Opencode.getConfig(baseUrl);
    log.info('engine.ctrl', 'getOpencodeConfig');
    ctx.body = result.data;
  } catch (err: any) {
    log.error('engine.ctrl', 'getOpencodeConfig error', err.message);
    ctx.status = 502;
    ctx.body = { error: 'Failed to fetch opencode config', detail: err.message };
  }
}
