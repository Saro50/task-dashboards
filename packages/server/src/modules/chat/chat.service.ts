import * as Opencode from '../engine/opencode.js';
import * as EngineService from '../engine/engine.service.js';
import { logger } from '../../logger.js';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import type { UploadImageResponse, MessagePartInput } from './types.js';

const S = 'chat.service';

// ---------------------------------------------------------------------------
// 图片上传服务
// ---------------------------------------------------------------------------

/** 允许上传的图片 MIME 及对应扩展名 */
const ALLOWED_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/** 最大文件大小 1 MB */
const MAX_FILE_SIZE = 1 * 1024 * 1024;

/**
 * 获取图片临时存储根目录（.opencode/tmp/images）。
 * 同时确保目录存在——若不存在则递归创建。
 *
 * 上游（uploadImage）与下游（controller serveImage 端点）均使用此函数
 * 获取统一根路径，避免路径硬编码分散。
 */
export function getImageDir(workdir: string): string {
  const imageDir = path.join(workdir, '.opencode', 'tmp', 'images');
  if (!fs.existsSync(imageDir)) {
    fs.mkdirSync(imageDir, { recursive: true });
  }
  return imageDir;
}

/**
 * 清理临时图片目录中超过 maxAge 毫秒的文件。
 *
 * 默认保留 1 小时（3600000ms）。在上传时自动触发，
 * 防止临时目录无限膨胀。
 */
function cleanupOldFiles(imageDir: string, maxAgeMs: number = 3600_000): void {
  try {
    const now = Date.now();
    for (const entry of fs.readdirSync(imageDir)) {
      const fullPath = path.join(imageDir, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile() && now - stat.mtimeMs > maxAgeMs) {
          fs.unlinkSync(fullPath);
          logger.info(S, 'cleanupOldFiles removed', { file: entry });
        }
      } catch {
        // 单文件清理失败不阻断整体流程
      }
    }
  } catch (err: any) {
    logger.warn(S, 'cleanupOldFiles error', err.message);
  }
}

/**
 * 对上传图片执行无损压缩并保存到临时目录。
 *
 * 压缩策略：
 * - PNG → compressionLevel=9（最高压缩比，无损）
 * - JPEG → quality=100 + mozjpeg（视觉无损重编码）
 * - WebP → lossless=true
 * - GIF  → 原样保存（sharp 不支持 GIF 编码，直接保存原始 buffer）
 *
 * @param fileBuffer  原始文件 buffer
 * @param mime        图片 MIME 类型
 * @param ext         文件扩展名
 * @param imageDir    目标目录
 * @returns           压缩后的文件名（UUID.ext）
 */
async function compressAndSave(
  fileBuffer: Buffer,
  mime: string,
  ext: string,
  imageDir: string,
): Promise<{ filename: string; size: number }> {
  const id = uuidv4();
  const destFilename = `${id}.${ext}`;
  const destPath = path.join(imageDir, destFilename);

  let outputBuffer: Buffer;

  switch (mime) {
    case 'image/png':
      outputBuffer = await sharp(fileBuffer)
        .png({ compressionLevel: 9 })
        .toBuffer();
      break;
    case 'image/jpeg':
      outputBuffer = await sharp(fileBuffer)
        .jpeg({ quality: 100 })
        .toBuffer();
      break;
    case 'image/webp':
      outputBuffer = await sharp(fileBuffer)
        .webp({ lossless: true })
        .toBuffer();
      break;
    case 'image/gif':
      // GIF 直接保存原始数据，sharp 不支持 GIF 输出
      outputBuffer = fileBuffer;
      break;
    default:
      throw new Error(`Unsupported image format: ${mime}`);
  }

  fs.writeFileSync(destPath, outputBuffer);
  return { filename: destFilename, size: outputBuffer.length };
}

/**
 * 图片上传服务：校验 → 无损压缩 → 保存 → 返回元信息。
 *
 * @param fileBuffer  multer 解析出的文件 buffer
 * @param mimetype    文件 MIME 类型
 * @param originalName 原始文件名
 * @param workdir     项目工作目录（可选，默认 process.cwd()）
 */
export async function uploadImage(
  fileBuffer: Buffer,
  mimetype: string,
  originalName: string,
  workdir?: string,
): Promise<UploadImageResponse> {
  const cwd = workdir || process.cwd();
  logger.info(S, 'uploadImage', { mimetype, originalName, size: fileBuffer.length, workdir: cwd });

  // 1. 校验 MIME 格式合法性
  const ext = ALLOWED_MIME[mimetype];
  if (!ext) {
    throw new Error(
      `Unsupported image format: ${mimetype}. Allowed: ${Object.keys(ALLOWED_MIME).join(', ')}`,
    );
  }

  // 2. 校验文件大小
  if (fileBuffer.length > MAX_FILE_SIZE) {
    throw new Error(
      `Image size ${fileBuffer.length} bytes exceeds limit ${MAX_FILE_SIZE} bytes (1MB)`,
    );
  }

  // 3. 确保临时目录存在 & 清理过期文件
  const imageDir = getImageDir(cwd);
  cleanupOldFiles(imageDir);

  // 4. 无损压缩并保存
  const { filename, size } = await compressAndSave(fileBuffer, mimetype, ext, imageDir);

  // 5. 构建相对路径（相对于 workdir）
  const relativePath = path.relative(cwd, path.join(imageDir, filename));

  logger.info(S, 'uploadImage saved', { relativePath, size });

  return {
    path: relativePath,
    mime: mimetype,
    filename: originalName,
    size,
  };
}

// ---------------------------------------------------------------------------
// 聊天会话服务
// ---------------------------------------------------------------------------

async function getBaseUrl() {
  const url = await EngineService.getBaseUrl();
  logger.info(S, 'getBaseUrl:', url);
  return url;
}

export async function listSessions(directory?: string) {
  const baseUrl = await getBaseUrl();
  logger.info(S, 'listSessions', { baseUrl, directory });
  const result = await Opencode.listSessions(baseUrl, directory);
  logger.info(S, 'listSessions response', Array.isArray(result?.data) ? `array[${result.data.length}]` : 'non-array');
  return result.data;
}

export async function createSession(directory?: string, title?: string) {
  const baseUrl = await getBaseUrl();
  logger.info(S, 'createSession', { baseUrl, directory, title });
  const result = await Opencode.createSession(baseUrl, directory, title);
  logger.info(S, 'createSession result', result?.data);
  return result.data;
}

export async function getMessages(sessionId: string, directory?: string) {
  const baseUrl = await getBaseUrl();
  logger.info(S, 'getMessages', { baseUrl, sessionId, directory });
  const result = await Opencode.getSessionMessages(baseUrl, sessionId, directory);
  logger.info(S, 'getMessages result count:', result?.data?.length);
  return result.data;
}

export async function sendMessage(sessionId: string, parts: MessagePartInput[], directory?: string, agent?: string) {
  const baseUrl = await getBaseUrl();
  const partSummary = parts.map((p) =>
    p.type === 'text' ? `text(${p.text.slice(0, 40)})` : `file(${p.mime}, ${p.url})`,
  );
  logger.info(S, 'sendMessage calling sendPromptAsync', { baseUrl, sessionId, directory, agent, parts: partSummary });
  try {
    const result = await Opencode.sendPromptAsync(baseUrl, sessionId, parts, directory, agent);
    logger.info(S, 'sendPromptAsync returned', { result });
  } catch (err: any) {
    logger.error(S, 'sendPromptAsync threw', { message: err.message, stack: err.stack?.slice(0, 200) });
    throw err;
  }
}

export async function abortSession(sessionId: string, directory?: string) {
  const baseUrl = await getBaseUrl();
  logger.info(S, 'abortSession', { baseUrl, sessionId, directory });
  await Opencode.abortSession(baseUrl, sessionId, directory);
}

export async function subscribeEvents(directory?: string) {
  const baseUrl = await getBaseUrl();
  logger.info(S, 'subscribeEvents calling opencode.subscribeEvents', { baseUrl, directory });
  try {
    const result = await Opencode.subscribeEvents(baseUrl, directory);
    logger.info(S, 'subscribeEvents stream obtained', { hasStream: !!result?.stream });
    return result;
  } catch (err: any) {
    logger.error(S, 'subscribeEvents failed', { message: err.message });
    throw err;
  }
}

export async function updateSession(sessionId: string, title: string, directory?: string) {
  const baseUrl = await getBaseUrl();
  logger.info(S, 'updateSession', { baseUrl, sessionId, title, directory });
  const result = await Opencode.updateSession(baseUrl, sessionId, title, directory);
  logger.info(S, 'updateSession result', result?.data);
  return result.data;
}

export async function deleteSession(sessionId: string, directory?: string) {
  const baseUrl = await getBaseUrl();
  logger.info(S, 'deleteSession', { baseUrl, sessionId, directory });
  await Opencode.deleteSession(baseUrl, sessionId, directory);
  logger.info(S, 'deleteSession completed', { sessionId });
}
