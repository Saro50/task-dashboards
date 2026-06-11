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

const MAX_DEPTH = 8;
const MAX_RESULTS = 20;

/**
 * 解析 .gitignore 规则为可匹配的模式列表。
 *
 * 处理逻辑：
 * - 忽略空行和 # 开头的注释
 * - 保留尾随 / 的目录模式（去掉 / 后存储，匹配时同时匹配文件和目录）
 * - 去掉前导 /
 *
 * 上游：由 loadGitignorePatterns 调用
 * 下游：返回 string[]，供 isIgnored 使用
 */
function parseGitignore(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((pattern) => {
      // 去掉尾随 /（gitignore 中 dir/ 表示只匹配目录，我们简化为同时匹配文件和目录）
      if (pattern.endsWith('/')) pattern = pattern.slice(0, -1);
      // 去掉前导 /（gitignore 中 /foo 表示只匹配根目录下的 foo，我们简化为任意层级）
      if (pattern.startsWith('/')) pattern = pattern.slice(1);
      // 去掉前导 **/（与无前缀效果相同）
      if (pattern.startsWith('**/')) pattern = pattern.slice(3);
      // 去掉尾随 /**
      if (pattern.endsWith('/**')) pattern = pattern.slice(0, -3);
      return pattern;
    })
    .filter((p) => p.length > 0);
}

/**
 * 判断相对路径是否被 gitignore 模式匹配。
 *
 * 仅实现 gitignore 的子集：
 * - * 匹配除 / 外的任意字符
 * - ** 匹配任意路径段（含 /）
 * - 无通配符时做子串匹配（检查路径中是否有某段与模式完全相同）
 *
 * 上游：由 walkDir 调用
 * 下游：返回 true 表示该路径应被忽略
 */
function isIgnored(relativePath: string, patterns: string[]): boolean {
  const parts = relativePath.split('/');
  const lower = relativePath.toLowerCase();

  for (const raw of patterns) {
    const p = raw.toLowerCase();

    // 模式不含通配符：匹配路径段或子串
    if (!p.includes('*')) {
      // 精确匹配某个路径段
      for (const part of parts) {
        if (part === p) return true;
      }
      // 也检查完整相对路径是否包含该模式（如 .env.local 匹配 .env*）
      if (lower === p) return true;
      continue;
    }

    // 含通配符 → 转为简易正则
    const reStr = p
      .split('**')
      .map((seg) =>
        seg
          .split('*')
          .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
          .join('[^/]*'),
      )
      .join('.*');
    try {
      if (new RegExp(`(^|/)${reStr}$`).test(lower)) return true;
    } catch {
      // 正则异常时跳过该模式
    }
  }

  return false;
}

/**
 * 从指定目录加载 .gitignore 文件并返回解析后的模式列表。
 * 如果文件不存在或读取失败则返回空数组。
 *
 * 上游：由 searchFiles 调用
 * 下游：返回 string[]，供 walkDir 的忽略判断使用
 */
function loadGitignorePatterns(directory: string): string[] {
  const gitignorePath = path.join(directory, '.gitignore');
  try {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    return parseGitignore(content);
  } catch {
    return [];
  }
}

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

  // 加载 .gitignore 规则，递归搜索时用于过滤匹配文件
  const ignorePatterns = loadGitignorePatterns(absoluteDir);

  // query 为空 → 返回根目录文件 + 第一层子目录（非黑名单 + 非 gitignore）
  if (!query || query.trim() === '') {
    const results: string[] = [];
    for (const dirent of dirents) {
      if (SKIP_DIRS.has(dirent.name)) continue;
      if (dirent.name.startsWith('.') && dirent.name !== '.env') continue;
      if (ignorePatterns.length > 0 && isIgnored(dirent.name, ignorePatterns)) continue;
      results.push(dirent.name + (dirent.isDirectory() ? '/' : ''));
      if (results.length >= MAX_RESULTS) break;
    }
    return results;
  }

  // query 非空 → 递归搜索
  const lowerQuery = query.toLowerCase();
  const results: string[] = [];

  await walkDir(absoluteDir, absoluteDir, 0, lowerQuery, results, ignorePatterns);

  // 按路径长度排序，短路径优先
  results.sort((a, b) => a.length - b.length);

  return results.slice(0, MAX_RESULTS);
}

/**
 * 递归遍历目录，收集匹配 query 的文件相对路径。
 * 此函数为 searchFiles 的内部实现，不对外暴露。
 *
 * @param ignorePatterns - 从 .gitignore 解析出的忽略模式，为空数组时跳过 gitignore 检查
 */
async function walkDir(
  currentDir: string,
  rootDir: string,
  depth: number,
  lowerQuery: string,
  results: string[],
  ignorePatterns: string[],
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

    // 跳过 .gitignore 匹配的文件/目录
    if (ignorePatterns.length > 0 && isIgnored(relativePath, ignorePatterns)) continue;

    if (dirent.isDirectory()) {
      await walkDir(fullPath, rootDir, depth + 1, lowerQuery, results, ignorePatterns);
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
