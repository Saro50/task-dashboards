import { Context, Next } from 'koa';
import { logger } from '../logger.js';

export async function errorHandler(ctx: Context, next: Next) {
  try {
    await next();
  } catch (err: any) {
    ctx.status = err.status || 500;
    ctx.body = {
      error: err.message || 'Internal Server Error',
      requestId: ctx.state.requestId || undefined,
    };
    logger.error('errorHandler', ctx.state.requestId || '-', err.message);
    ctx.app.emit('error', err, ctx);
  }
}
