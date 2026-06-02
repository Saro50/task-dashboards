/**
 * Mock engine — 模拟 opencode SDK v2 的执行结果。
 *
 * 用途：在没有运行 opencode engine 的情况下测试完整的任务链执行流程，
 * 包括 DAG 排序、批量执行、stop 穿透、abort 中断、部分失败等场景。
 *
 * 启用方式：设置环境变量 MOCK_ENGINE=true
 * 配置参数：
 *   MOCK_WT_DELAY=500         worktree 创建延迟 (ms)
 *   MOCK_SESSION_DELAY=300    session 创建延迟 (ms)
 *   MOCK_TASK_DELAY=2000      每批任务 AI 处理延迟 (ms)
 *   MOCK_FAILURE_RATE=0       0-1，随机任务失败概率（不生成 assistant 消息）
 *   MOCK_FAIL_AFTER=0         每个会话内，在 N 个成功任务后开始失败（0=不限）
 *
 * 原理：所有状态保存在内存中（worktrees / sessions / messages），
 * execution.service.ts 调用 opencode-v2.ts 的函数 → mock 拦截 → 返回模拟数据。
 * 上层业务逻辑完全走真实代码路径，只是底层的 SDK 调用被替换了。
 */
import { logger } from '../../logger.js';

const S = 'engine-mock';

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}

function envFloat(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = parseFloat(v);
  return Number.isNaN(n) ? fallback : n;
}

const CONF = {
  wtDelay: envInt('MOCK_WT_DELAY', 500),
  sessionDelay: envInt('MOCK_SESSION_DELAY', 300),
  taskDelay: envInt('MOCK_TASK_DELAY', 2000),
  failureRate: envFloat('MOCK_FAILURE_RATE', 0),
  failAfter: envInt('MOCK_FAIL_AFTER', 0),
};

export function isMockEnabled(): boolean {
  return process.env.MOCK_ENGINE === 'true';
}

export interface WorktreeInfo {
  name: string;
  branch?: string;
  directory: string;
}

export interface SessionInfo {
  id: string;
  title?: string;
}

interface MockWorktree {
  name: string;
  branch: string;
  directory: string;
}

interface MockSession {
  id: string;
  title?: string;
  directory: string;
  aborted: boolean;
  pendingPrompts: string[];
  messages: { role: string; parts: { type: string; text: string }[] }[];
  abortCallbacks: Set<() => void>;
  successCount: number;
}

let _nextId = 1;
function cuid(): string {
  return `mock-${Date.now()}-${_nextId++}`;
}

const worktrees = new Map<string, MockWorktree>();
const sessions = new Map<string, MockSession>();

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class MockEngine {
  async createWorktree(
    _baseUrl: string,
    directory: string,
    name?: string,
  ): Promise<WorktreeInfo> {
    logger.info(S, 'mock createWorktree', { directory, name });
    await delay(CONF.wtDelay);

    const wtName = name || `mock-wt-${Date.now()}`;
    const branch = `opencode/${wtName}`;
    const wtDirectory = `/tmp/mock-worktree/${wtName}`;

    const wt: MockWorktree = { name: wtName, branch, directory: wtDirectory };
    worktrees.set(wtDirectory, wt);

    logger.info(S, 'mock worktree created', { name: wtName, branch, directory: wtDirectory });
    return { name: wtName, branch, directory: wtDirectory };
  }

  async listWorktrees(_baseUrl: string, _directory: string): Promise<WorktreeInfo[]> {
    return Array.from(worktrees.values()).map((wt) => ({
      name: wt.name,
      branch: wt.branch,
      directory: wt.directory,
    }));
  }

  async removeWorktree(
    _baseUrl: string,
    _directory: string,
    worktreeDirectory: string,
  ): Promise<void> {
    logger.info(S, 'mock removeWorktree', { worktreeDirectory });
    worktrees.delete(worktreeDirectory);
  }

  async createSessionInWorkspace(
    _baseUrl: string,
    directory: string,
    options: { workspaceID?: string; title?: string; agent?: string },
  ): Promise<SessionInfo> {
    logger.info(S, 'mock createSessionInWorkspace', { directory, title: options.title });
    await delay(CONF.sessionDelay);

    const id = cuid();
    const session: MockSession = {
      id,
      title: options.title,
      directory,
      aborted: false,
      pendingPrompts: [],
      messages: [],
      abortCallbacks: new Set(),
      successCount: 0,
    };
    sessions.set(id, session);

    logger.info(S, 'mock session created', { id, title: options.title });
    return { id, title: options.title };
  }

  async sendPrompt(
    _baseUrl: string,
    sessionId: string,
    text: string,
    _directory: string,
  ): Promise<void> {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`Mock session not found: ${sessionId}`);
    if (session.aborted) throw new Error('Session already aborted');

    session.pendingPrompts.push(text);
    logger.info(S, 'mock sendPrompt', { sessionId, text: text.slice(0, 60), pending: session.pendingPrompts.length });
  }

  async waitForSessionIdle(
    _baseUrl: string,
    sessionId: string,
    _directory: string,
  ): Promise<void> {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`Mock session not found: ${sessionId}`);
    if (session.aborted) throw new Error('Session already aborted');

    const promptCount = session.pendingPrompts.length;
    if (promptCount === 0) {
      logger.info(S, 'mock waitForSessionIdle — no pending prompts, resolve immediately');
      return;
    }

    logger.info(S, 'mock waitForSessionIdle — waiting', {
      sessionId,
      promptCount,
      delay: CONF.taskDelay,
    });

    let abortCb: (() => void) | null = null;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (abortCb) session.abortCallbacks.delete(abortCb);
        resolve();
      }, CONF.taskDelay);

      abortCb = () => {
        clearTimeout(timer);
        reject(new Error('Session aborted by user'));
      };
      session.abortCallbacks.add(abortCb);
    });

    if (session.aborted) throw new Error('Session aborted');

    this.generateResponses(session);
  }

  async getSessionMessages(
    _baseUrl: string,
    sessionId: string,
    _directory: string,
  ): Promise<any[]> {
    const session = sessions.get(sessionId);
    if (!session) return [];
    return [...session.messages];
  }

  async getSessionStatus(_baseUrl: string, _directory: string): Promise<any> {
    return { status: 'idle' };
  }

  async abortSession(
    _baseUrl: string,
    sessionId: string,
    _directory: string,
  ): Promise<void> {
    const session = sessions.get(sessionId);
    if (!session) return;

    logger.info(S, 'mock abortSession', { sessionId });
    session.aborted = true;

    for (const cb of session.abortCallbacks) {
      try { cb(); } catch {}
    }
    session.abortCallbacks.clear();
  }

  private generateResponses(session: MockSession): void {
    for (const text of session.pendingPrompts) {
      session.messages.push({
        role: 'user',
        parts: [{ type: 'text', text }],
      });

      const shouldFail = this.shouldFail(session);
      if (!shouldFail) {
        session.messages.push({
          role: 'assistant',
          parts: [{ type: 'text', text: `[Mock AI] 任务已完成。` }],
        });
        session.successCount++;
      } else {
        logger.info(S, 'mock generateResponses — simulating failure', {
          successCount: session.successCount,
        });
      }
    }
    session.pendingPrompts = [];
  }

  private shouldFail(session: MockSession): boolean {
    if (CONF.failAfter > 0 && session.successCount >= CONF.failAfter) {
      return true;
    }
    if (CONF.failureRate > 0 && Math.random() < CONF.failureRate) {
      return true;
    }
    return false;
  }
}

export const mockEngine = new MockEngine();
