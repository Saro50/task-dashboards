import { Context } from 'koa';
import fs from 'fs';
import path from 'path';
import { searchFiles } from './project.fs.js';
import { reqLogger } from '../../logger.js';

/**
 * GET /api/projects/search-files?directory=xxx&query=yyy
 *
 * 搜索指定工作目录下的文件，返回相对路径列表。
 * - directory: 必填，工作目录绝对路径
 * - query: 可选，搜索关键词（空则返回根目录概览）
 *
 * 上游：由 project-file.routes 注册，前端 @ 文件搜索调用
 * 下游：委托 project.fs.searchFiles 执行实际文件遍历
 */
export async function searchFilesHandler(ctx: Context) {
  const log = reqLogger(ctx.state.requestId);
  const directory = ctx.query.directory as string | undefined;
  const query = ctx.query.query as string | undefined;

  if (!directory || typeof directory !== 'string') {
    ctx.status = 400;
    ctx.body = { error: 'directory is required' };
    return;
  }

  const absoluteDir = path.resolve(directory);

  // 校验路径存在且是目录
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absoluteDir);
  } catch {
    ctx.status = 400;
    ctx.body = { error: `directory does not exist: ${absoluteDir}` };
    return;
  }

  if (!stat.isDirectory()) {
    ctx.status = 400;
    ctx.body = { error: `path is not a directory: ${absoluteDir}` };
    return;
  }

  try {
    const files = await searchFiles(absoluteDir, query);
    log.info('project-file.ctrl', 'searchFiles', {
      directory: absoluteDir,
      query: query || '(empty)',
      count: files.length,
    });
    ctx.body = { data: { files } };
  } catch (err: any) {
    log.error('project-file.ctrl', 'searchFiles error', err.message);
    throw err;
  }
}
