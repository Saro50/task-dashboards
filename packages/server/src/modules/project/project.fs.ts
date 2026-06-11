import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export interface DirCheckResult {
  exists: boolean;
  isGitRepo: boolean;
  absolutePath: string;
}

// ─── 目录遍历黑名单 ────────────────────────────────────────
// 这些目录通常包含大量自动生成的文件，跳过它们可以显著提升搜索速度并避免无意义结果
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.cache',
  '.nyc_output',
  'coverage',
  '.turbo',
  '.vercel',
  '.husky',
]);

const MAX_DEPTH = 3;
const MAX_RESULTS = 20;

export function checkDir(dirPath: string): DirCheckResult {
  const absolutePath = path.resolve(dirPath);
  const exists = fs.existsSync(absolutePath);

  let isGitRepo = false;
  if (exists) {
    isGitRepo = fs.existsSync(path.join(absolutePath, '.git'));
  }

  return { exists, isGitRepo, absolutePath };
}

export function ensureDir(dirPath: string): DirCheckResult {
  const absolutePath = path.resolve(dirPath);

  if (!fs.existsSync(absolutePath)) {
    fs.mkdirSync(absolutePath, { recursive: true });
  }

  const isGitRepo = fs.existsSync(path.join(absolutePath, '.git'));
  if (!isGitRepo) {
    execSync('git init', { cwd: absolutePath, stdio: 'pipe' });
  }

  return {
    exists: true,
    isGitRepo: true,
    absolutePath,
  };
}

/**
 * 在指定目录下递归搜索文件，返回相对路径列表。
 *
 * - query 为空时：返回根目录下的文件 + 第一层子目录，方便用户快速浏览
 * - query 非空时：递归遍历（最大深度 MAX_DEPTH），对文件名做 case-insensitive 子串匹配
 * - 跳过 SKIP_DIRS 中的目录以避免性能问题
 * - 最多返回 MAX_RESULTS 条结果，按路径长度排序（短路径优先）
 *
 * 上游：由 project-file.controller.searchFiles 调用
 * 下游：返回字符串数组，前端用于 @ 文件引用的候选列表
 */
export async function searchFiles(
  directory: string,
  query?: string,
): Promise<string[]> {
  const absoluteDir = path.resolve(directory);
  const dirents = await fs.promises.readdir(absoluteDir, {
    withFileTypes: true,
  });

  // query 为空 → 返回根目录文件 + 第一层子目录（非黑名单）
  if (!query || query.trim() === '') {
    const results: string[] = [];
    for (const dirent of dirents) {
      if (SKIP_DIRS.has(dirent.name)) continue;
      if (dirent.name.startsWith('.') && dirent.name !== '.env') continue;
      results.push(dirent.name + (dirent.isDirectory() ? '/' : ''));
      if (results.length >= MAX_RESULTS) break;
    }
    return results;
  }

  // query 非空 → 递归搜索
  const lowerQuery = query.toLowerCase();
  const results: string[] = [];

  await walkDir(absoluteDir, absoluteDir, 0, lowerQuery, results);

  // 按路径长度排序，短路径优先
  results.sort((a, b) => a.length - b.length);

  return results.slice(0, MAX_RESULTS);
}

/**
 * 递归遍历目录，收集匹配 query 的文件相对路径。
 * 此函数为 searchFiles 的内部实现，不对外暴露。
 */
async function walkDir(
  currentDir: string,
  rootDir: string,
  depth: number,
  lowerQuery: string,
  results: string[],
): Promise<void> {
  // 已收集够结果或超过最大深度就停止
  if (results.length >= MAX_RESULTS || depth > MAX_DEPTH) return;

  let dirents: fs.Dirent[];
  try {
    dirents = await fs.promises.readdir(currentDir, { withFileTypes: true });
  } catch {
    // 权限不足等异常静默跳过（不影响整体搜索）
    return;
  }

  for (const dirent of dirents) {
    if (results.length >= MAX_RESULTS) return;

    const name = dirent.name;

    // 跳过黑名单目录和隐藏文件
    if (SKIP_DIRS.has(name)) continue;
    if (name.startsWith('.') && name !== '.env') continue;

    const fullPath = path.join(currentDir, name);
    const relativePath = path.relative(rootDir, fullPath);

    if (dirent.isDirectory()) {
      await walkDir(fullPath, rootDir, depth + 1, lowerQuery, results);
    } else {
      // case-insensitive 子串匹配：匹配文件名或相对路径
      if (
        name.toLowerCase().includes(lowerQuery) ||
        relativePath.toLowerCase().includes(lowerQuery)
      ) {
        results.push(relativePath);
      }
    }
  }
}
