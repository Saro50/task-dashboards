import crypto from 'crypto';
import { Context, Next } from 'koa';

export async function requestId(ctx: Context, next: Next) {
  const id = crypto.randomUUID();
  ctx.state.requestId = id;
  ctx.set('X-Request-Id', id);

  await next();

  if (
    ctx.status === 204 ||
    ctx.res.headersSent ||
    !ctx.body ||
    ctx.response.get('Content-Type')?.includes('text/event-stream')
  ) {
    return;
  }

  if (Array.isArray(ctx.body)) {
    ctx.body = { requestId: id, data: ctx.body };
  } else if (typeof ctx.body === 'object') {
    ctx.body = { ...ctx.body, requestId: id };
  }
}
