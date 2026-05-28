import { Context } from 'koa';
import * as Service from './chat.service';
import { logger } from '../../logger';
import type { CreateSessionBody, SendMessageBody } from './types';

const S = 'chat.ctrl';

export async function listSessions(ctx: Context) {
  try {
    const directory = ctx.query.directory as string | undefined;
    logger.info(S, 'listSessions', { directory });
    const sessions = await Service.listSessions(directory);
    logger.info(S, 'listSessions result count:', sessions?.length);
    ctx.body = sessions;
  } catch (err: any) {
    logger.error(S, 'listSessions error', err.message);
    ctx.status = 502;
    ctx.body = { error: 'Failed to list sessions', detail: err.message };
  }
}

export async function createSession(ctx: Context) {
  try {
    const { directory, title } = ctx.request.body as CreateSessionBody;
    logger.info(S, 'createSession', { directory, title });
    const session = await Service.createSession(directory, title);
    logger.info(S, 'createSession result', session?.id, session?.title);
    ctx.body = session;
  } catch (err: any) {
    logger.error(S, 'createSession error', err.message);
    ctx.status = 502;
    ctx.body = { error: 'Failed to create session', detail: err.message };
  }
}

export async function getMessages(ctx: Context) {
  try {
    const { id } = ctx.params;
    const directory = ctx.query.directory as string | undefined;
    logger.info(S, 'getMessages', { sessionId: id, directory });
    const messages = await Service.getMessages(id, directory);
    logger.info(S, 'getMessages result count:', messages?.length);
    ctx.body = messages;
  } catch (err: any) {
    logger.error(S, 'getMessages error', err.message);
    ctx.status = 502;
    ctx.body = { error: 'Failed to get messages', detail: err.message };
  }
}

export async function sendMessage(ctx: Context) {
  try {
    const { id } = ctx.params;
    const directory = ctx.query.directory as string | undefined;
    const { text, agent } = ctx.request.body as SendMessageBody;
    logger.info(S, 'sendMessage', { sessionId: id, directory, text: text?.slice(0, 80), agent });
    if (!text || typeof text !== 'string') {
      ctx.status = 400;
      ctx.body = { error: 'text is required' };
      return;
    }
    await Service.sendMessage(id, text, directory);
    logger.info(S, 'sendMessage promptAsync accepted');
    ctx.status = 204;
  } catch (err: any) {
    logger.error(S, 'sendMessage error', err.message);
    ctx.status = 502;
    ctx.body = { error: 'Failed to send message', detail: err.message };
  }
}

export async function abortSession(ctx: Context) {
  try {
    const { id } = ctx.params;
    const directory = ctx.query.directory as string | undefined;
    logger.info(S, 'abortSession', { sessionId: id, directory });
    await Service.abortSession(id, directory);
    ctx.status = 204;
  } catch (err: any) {
    logger.error(S, 'abortSession error', err.message);
    ctx.status = 502;
    ctx.body = { error: 'Failed to abort session', detail: err.message };
  }
}

export async function subscribeEvents(ctx: Context) {
  try {
    const directory = ctx.query.directory as string | undefined;
    logger.info(S, 'subscribeEvents SSE starting', { directory });
    const result = await Service.subscribeEvents(directory);
    logger.info(S, 'subscribeEvents stream obtained');

    ctx.set('Content-Type', 'text/event-stream');
    ctx.set('Cache-Control', 'no-cache');
    ctx.set('Connection', 'keep-alive');
    ctx.set('X-Accel-Buffering', 'no');
    ctx.status = 200;
    ctx.res.flushHeaders();
    ctx.res.write(': connected\n\n');

    const stream = result.stream;
    let closed = false;
    let eventCount = 0;
    let deltaCount = 0;
    let firstDeltaTs = 0;
    let lastDeltaTs = 0;

    ctx.req.on('close', () => {
      logger.info(S, 'SSE client disconnected', { eventCount, deltaCount });
      closed = true;
      if (stream && typeof stream.return === 'function') {
        stream.return(undefined);
      }
    });

    const FORWARD_EVENTS = new Set([
      'message.part.updated',
      'message.part.delta',
      'message.updated',
      'session.status',
      'session.created',
      'session.updated',
      'session.idle',
    ]);

    for await (const event of stream) {
      if (closed) break;

      const eventType = event?.type;
      if (!eventType || !FORWARD_EVENTS.has(eventType)) continue;

      const properties = event?.properties || {};
      eventCount++;

      if (eventType === 'message.part.delta') {
        deltaCount++;
        const now = Date.now();
        if (!firstDeltaTs) firstDeltaTs = now;
        lastDeltaTs = now;
        if (deltaCount === 1) {
          logger.info(S, 'SSE first delta received', { delta: (properties as any)?.delta?.slice(0, 40) });
        }
      } else {
        if (eventCount <= 10 || eventCount % 50 === 0) {
          logger.info(S, 'SSE forwarding event', { eventType, eventCount });
        }
      }

      ctx.res.write(`event: ${eventType}\ndata: ${JSON.stringify(properties)}\n\n`);
    }

    logger.info(S, 'SSE stream ended', { eventCount, deltaCount, deltaDurationMs: lastDeltaTs && firstDeltaTs ? lastDeltaTs - firstDeltaTs : 0 });
    if (!closed) {
      ctx.res.write('event: done\ndata: {}\n\n');
    }
    ctx.res.end();
  } catch (err: any) {
    logger.error(S, 'subscribeEvents error', err.message);
    if (!ctx.headerSent) {
      ctx.status = 502;
      ctx.body = { error: 'Failed to subscribe events', detail: err.message };
    } else {
      ctx.res.end();
    }
  }
}

export async function clientLog(ctx: Context) {
  try {
    const body = ctx.request.body as any;
    const entries: Array<{ level: string; scope: string; message: string; data?: unknown }> =
      body?.batch ?? [body];
    for (const { level, scope, message, data } of entries) {
      if (!level || !scope || !message) continue;
      const msg = data !== undefined ? `${message} ${JSON.stringify(data)}` : message;
      if (level === 'error') {
        logger.error('client.' + scope, msg);
      } else if (level === 'warn') {
        logger.warn('client.' + scope, msg);
      } else {
        logger.info('client.' + scope, msg);
      }
    }
    ctx.status = 204;
  } catch {
    ctx.status = 204;
  }
}
