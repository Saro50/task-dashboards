import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export interface DirCheckResult {
  exists: boolean;
  isGitRepo: boolean;
  absolutePath: string;
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
