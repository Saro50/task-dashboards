import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { checkDir, ensureDir } from '../modules/project/project.fs';

describe('checkDir', () => {
  it('should return exists=false when directory does not exist', () => {
    const result = checkDir('/tmp/definitely-nonexistent-dir-' + Date.now());
    expect(result.exists).toBe(false);
    expect(result.isGitRepo).toBe(false);
    expect(result.absolutePath).toBeTruthy();
  });

  it('should return exists=true, isGitRepo=false for existing directory without .git', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-checkdir-'));
    try {
      const result = checkDir(tmpDir);
      expect(result.exists).toBe(true);
      expect(result.isGitRepo).toBe(false);
    } finally {
      fs.rmdirSync(tmpDir);
    }
  });

  it('should return exists=true, isGitRepo=true for git-initialized directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-checkdir-git-'));
    fs.mkdirSync(path.join(tmpDir, '.git'));
    try {
      const result = checkDir(tmpDir);
      expect(result.exists).toBe(true);
      expect(result.isGitRepo).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

describe('ensureDir', () => {
  let tmpBase: string;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'test-ensuredir-'));
  });

  afterEach(() => {
    fs.rmSync(tmpBase, { recursive: true });
  });

  it('should create directory if it does not exist', () => {
    const target = path.join(tmpBase, 'new-project');
    const result = ensureDir(target);
    expect(result.exists).toBe(true);
    expect(result.isGitRepo).toBe(true);
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.existsSync(path.join(target, '.git'))).toBe(true);
  });

  it('should initialize git in existing directory without .git', () => {
    const target = path.join(tmpBase, 'existing-project');
    fs.mkdirSync(target);
    const result = ensureDir(target);
    expect(result.exists).toBe(true);
    expect(result.isGitRepo).toBe(true);
    expect(fs.existsSync(path.join(target, '.git'))).toBe(true);
  });

  it('should not re-initialize git if .git already exists', () => {
    const target = path.join(tmpBase, 'git-project');
    fs.mkdirSync(target);
    fs.mkdirSync(path.join(target, '.git'));
    const result = ensureDir(target);
    expect(result.exists).toBe(true);
    expect(result.isGitRepo).toBe(true);
  });
});
