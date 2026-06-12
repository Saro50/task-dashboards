import { Context } from 'koa';
import fs from 'fs';
import path from 'path';
import * as Service from './chat.service.js';
import { reqLogger } from '../../logger.js';
import type { CreateSessionBody, SendMessageBody, UpdateSessionBody, MessagePartInput } from './types.js';

const S = 'chat.ctrl';

export async function listSessions(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  try {
    const directory = ctx.query.directory as string | undefined;
    log.info(S, 'listSessions', { directory });
    const sessions = await Service.listSessions(directory);
    log.info(S, 'listSessions result count:', sessions?.length);
    ctx.body = sessions;
  } catch (err: any) {
    log.error(S, 'listSessions error', err.message);
    ctx.status = 502;
    ctx.body = { error: 'Failed to list sessions', detail: err.message };
  }
}

export async function createSession(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  try {
    const { directory, title } = ctx.request.body as CreateSessionBody;
    log.info(S, 'createSession', { directory, title });
    const session = await Service.createSession(directory, title);
    log.info(S, 'createSession result', session?.id, session?.title);
    ctx.body = session;
  } catch (err: any) {
    log.error(S, 'createSession error', err.message);
    ctx.status = 502;
    ctx.body = { error: 'Failed to create session', detail: err.message };
  }
}

export async function updateSession(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  try {
    const { id } = ctx.params;
    const directory = ctx.query.directory as string | undefined;
    const { title } = ctx.request.body as UpdateSessionBody;
    log.info(S, 'updateSession', { sessionId: id, directory, title });
    if (!title || typeof title !== 'string') {
      ctx.status = 400;
      ctx.body = { error: 'title is required' };
      return;
    }
    const session = await Service.updateSession(id, title, directory);
    log.info(S, 'updateSession result', session?.id, session?.title);
    ctx.body = session;
  } catch (err: any) {
    log.error(S, 'updateSession error', err.message);
    ctx.status = 502;
    ctx.body = { error: 'Failed to update session', detail: err.message };
  }
}

export async function deleteSession(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  try {
    const { id } = ctx.params;
    const directory = ctx.query.directory as string | undefined;
    log.info(S, 'deleteSession', { sessionId: id, directory });
    await Service.deleteSession(id, directory);
    log.info(S, 'deleteSession completed', { sessionId: id });
    ctx.status = 204;
  } catch (err: any) {
    log.error(S, 'deleteSession error', err.message);
    ctx.status = 502;
    ctx.body = { error: 'Failed to delete session', detail: err.message };
  }
}

export async function getMessages(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  try {
    const { id } = ctx.params;
    const directory = ctx.query.directory as string | undefined;
    log.info(S, 'getMessages', { sessionId: id, directory });
    const messages = await Service.getMessages(id, directory);
    log.info(S, 'getMessages result count:', messages?.length);
    ctx.body = messages;
  } catch (err: any) {
    log.error(S, 'getMessages error', err.message);
    ctx.status = 502;
    ctx.body = { error: 'Failed to get messages', detail: err.message };
  }
}

export async function sendMessage(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  try {
    const { id } = ctx.params;
    const directory = ctx.query.directory as string | undefined;
    const body = ctx.request.body as SendMessageBody;
    const { text, parts, agent } = body;

    // 向后兼容：若前端只传了 text（旧版），自动包装为 TextPartInput
    let normalizedParts: MessagePartInput[];
    if (parts && Array.isArray(parts) && parts.length > 0) {
      normalizedParts = parts;
    } else if (text && typeof text === 'string') {
      normalizedParts = [{ type: 'text', text }];
    } else {
      ctx.status = 400;
      ctx.body = { error: 'text or parts is required' };
      return;
    }

    const partSummary = normalizedParts.map((p) =>
      p.type === 'text' ? `text(${(p as { type: 'text'; text: string }).text.slice(0, 40)})` : `file(${(p as { type: 'file'; mime: string; url: string }).mime}, ${(p as { type: 'file'; url: string }).url})`,
    );
    log.info(S, 'sendMessage', { sessionId: id, directory, parts: partSummary, agent });

    await Service.sendMessage(id, normalizedParts, directory, agent);
    log.info(S, 'sendMessage promptAsync accepted');
    ctx.status = 204;
  } catch (err: any) {
    log.error(S, 'sendMessage error', err.message);
    ctx.status = 502;
    ctx.body = { error: 'Failed to send message', detail: err.message };
  }
}

export async function abortSession(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  try {
    const { id } = ctx.params;
    const directory = ctx.query.directory as string | undefined;
    log.info(S, 'abortSession', { sessionId: id, directory });
    await Service.abortSession(id, directory);
    ctx.status = 204;
  } catch (err: any) {
    log.error(S, 'abortSession error', err.message);
    ctx.status = 502;
    ctx.body = { error: 'Failed to abort session', detail: err.message };
  }
}

export async function subscribeEvents(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  try {
    const directory = ctx.query.directory as string | undefined;
    log.info(S, 'subscribeEvents SSE starting', { directory });
    const result = await Service.subscribeEvents(directory);
    log.info(S, 'subscribeEvents stream obtained');

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
      log.info(S, 'SSE client disconnected', { eventCount, deltaCount });
      closed = true;
      if (stream && typeof stream.return === 'function') {
        stream.return(undefined);
      }
    });

    const FORWARD_EVENTS = new Set<string>([
      'message.part.updated',
      'message.part.delta',
      'message.updated',
      'session.status',
      'session.created',
      'session.updated',
      'session.idle',
      'session.compacted',
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
          log.info(S, 'SSE first delta received', { delta: (properties as any)?.delta?.slice(0, 40) });
        }
      } else {
        if (eventCount <= 10 || eventCount % 50 === 0) {
          log.info(S, 'SSE forwarding event', { eventType, eventCount });
        }
      }

      ctx.res.write(`event: ${eventType}\ndata: ${JSON.stringify(properties)}\n\n`);
    }

    log.info(S, 'SSE stream ended', { eventCount, deltaCount, deltaDurationMs: lastDeltaTs && firstDeltaTs ? lastDeltaTs - firstDeltaTs : 0 });
    if (!closed) {
      ctx.res.write('event: done\ndata: {}\n\n');
    }
    ctx.res.end();
  } catch (err: any) {
    log.error(S, 'subscribeEvents error', err.message);
    if (!ctx.headerSent) {
      ctx.status = 502;
      ctx.body = { error: 'Failed to subscribe events', detail: err.message };
    } else {
      ctx.res.end();
    }
  }
}

export async function clientLog(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  try {
    const body = ctx.request.body as any;
    const entries: Array<{ level: string; scope: string; message: string; data?: unknown }> =
      body?.batch ?? [body];
    for (const { level, scope, message, data } of entries) {
      if (!level || !scope || !message) continue;
      const msg = data !== undefined ? `${message} ${JSON.stringify(data)}` : message;
      if (level === 'error') {
        log.error('client.' + scope, msg);
      } else if (level === 'warn') {
        log.warn('client.' + scope, msg);
      } else {
        log.info('client.' + scope, msg);
      }
    }
    ctx.status = 204;
  } catch {
    ctx.status = 204;
  }
}

/**
 * POST /api/chat/upload-image
 *
 * 接收 multipart/form-data 中的单个图片文件（字段名 "image"），
 * 调用 Service 进行校验、无损压缩并保存到临时目录。
 *
 * @koa/multer 中间件已在路由层将文件解析到 ctx.file，
 * 由于不使用 @types/koa__multer（避免全局类型侵入），此处通过断言读取。
 */
export async function uploadImage(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  try {
    const file = (ctx as any).file as
      | { buffer: Buffer; mimetype: string; originalname: string }
      | undefined;
    if (!file || !file.buffer) {
      ctx.status = 400;
      ctx.body = { error: 'No image file provided. Use field name "image".' };
      return;
    }

    const directory = ctx.query.directory as string | undefined;
    log.info(S, 'uploadImage', {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.buffer.length,
      directory,
    });

    const result = await Service.uploadImage(
      file.buffer,
      file.mimetype,
      file.originalname,
      directory,
    );

    log.info(S, 'uploadImage result', { path: result.path, size: result.size });
    ctx.body = result;
  } catch (err: any) {
    log.error(S, 'uploadImage error', err.message);
    // 区分校验错误（400）与内部错误（500/502）
    if (
      err.message.includes('Unsupported') ||
      err.message.includes('exceeds limit')
    ) {
      ctx.status = 400;
      ctx.body = { error: err.message };
    } else {
      ctx.status = 502;
      ctx.body = { error: 'Failed to upload image', detail: err.message };
    }
  }
}

/**
 * GET /api/chat/serve-image
 *
 * 根据查询参数 path（相对于工作目录的图片路径，如 .opencode/tmp/images/xxx.png）
 * 读取图片文件并返回二进制流。
 *
 * 安全措施：
 * 1. 路径白名单：仅允许 .opencode/tmp/images/ 下的文件
 * 2. 路径遍历检测：拒绝包含 .. 的路径
 * 3. 文件存在性检查
 *
 * 上游：前端 PartRenderer 渲染 file part 缩略图时请求此端点。
 * 下游：直接返回图片二进制流，Content-Type 为对应 MIME。
 */
export async function serveImage(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  try {
    const relativePath = ctx.query.path as string | undefined;
    const directory = ctx.query.directory as string | undefined;

    if (!relativePath) {
      ctx.status = 400;
      ctx.body = { error: 'Missing "path" query parameter' };
      return;
    }

    // 安全检查：路径遍历攻击防护
    if (relativePath.includes('..')) {
      ctx.status = 403;
      ctx.body = { error: 'Path traversal not allowed' };
      return;
    }

    // 安全检查：仅允许 .opencode/tmp/images/ 前缀
    const normalized = path.normalize(relativePath);
    if (!normalized.startsWith('.opencode/tmp/images/') && !normalized.startsWith('.opencode\\tmp\\images\\')) {
      ctx.status = 403;
      ctx.body = { error: 'Only images under .opencode/tmp/images/ can be served' };
      return;
    }

    const workdir = directory || process.cwd();
    const fullPath = path.resolve(workdir, normalized);

    // 再次检查 resolve 后的路径确实在 images 目录下
    const imageDir = path.resolve(workdir, '.opencode', 'tmp', 'images');
    if (!fullPath.startsWith(imageDir)) {
      ctx.status = 403;
      ctx.body = { error: 'Access denied' };
      return;
    }

    if (!fs.existsSync(fullPath)) {
      ctx.status = 404;
      ctx.body = { error: 'Image not found' };
      return;
    }

    // 根据 MIME 类型返回正确的 Content-Type
    const ext = path.extname(fullPath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    };
    const mime = mimeMap[ext] || 'application/octet-stream';

    ctx.set('Content-Type', mime);
    ctx.set('Cache-Control', 'private, max-age=3600');
    ctx.body = fs.createReadStream(fullPath);
  } catch (err: any) {
    log.error(S, 'serveImage error', err.message);
    ctx.status = 500;
    ctx.body = { error: 'Failed to serve image', detail: err.message };
  }
}
