/**
 * opencode SDK v2 客户端封装。
 *
 * 为什么需要这个文件而不是复用 opencode.ts（SDK v1）：
 * - SDK v1 没有 worktree API，无法创建隔离的执行环境
 * - SDK v2 提供了 worktree.create/remove/list 和 v2.session.wait 等关键能力
 * - v2.session.wait 是替代 setTimeout 模拟的核心：它会阻塞直到 AI agent loop 处理完所有消息，
 *   这样我们就能准确知道每个任务何时真正执行完毕
 *
 * Mock 模式：设置环境变量 MOCK_ENGINE=true 时，adapter 切换为 MockEngine，
 * 无需运行 opencode engine 即可测试完整的任务链执行流程。
 * 选择在模块加载时一次性完成，不存在运行时分发开销。
 */
import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk/v2';
import { logger } from '../../logger.js';
import { isMockEnabled, mockEngine } from './engine-mock.js';

const S = 'opencode-v2';

let _client: OpencodeClient | null = null;
let _baseUrl: string | null = null;

async function getClient(baseUrl: string) {
  if (_client && _baseUrl === baseUrl) return _client;
  logger.info(S, 'getClient creating new v2 client', { baseUrl });
  _client = createOpencodeClient({ baseUrl });
  _baseUrl = baseUrl;
  return _client;
}

export function resetClient() {
  _client = null;
  _baseUrl = null;
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

interface EngineAdapter {
  createWorktree(baseUrl: string, directory: string, name?: string): Promise<WorktreeInfo>;
  listWorktrees(baseUrl: string, directory: string): Promise<WorktreeInfo[]>;
  removeWorktree(baseUrl: string, directory: string, worktreeDirectory: string): Promise<void>;
  createSessionInWorkspace(baseUrl: string, directory: string, options: { workspaceID?: string; title?: string; agent?: string }): Promise<SessionInfo>;
  sendPrompt(baseUrl: string, sessionId: string, text: string, directory: string, options?: { workspace?: string; agent?: string }): Promise<void>;
  getSessionStatus(baseUrl: string, directory: string): Promise<any>;
  abortSession(baseUrl: string, sessionId: string, directory: string): Promise<void>;
  waitForSessionIdle(baseUrl: string, sessionId: string, directory: string, timeoutMs?: number): Promise<void>;
  waitForAssistantMessages(baseUrl: string, sessionId: string, directory: string, targetCount: number, timeoutMs?: number): Promise<void>;
  waitForAssistantText(baseUrl: string, sessionId: string, directory: string, substring: string, timeoutMs?: number): Promise<void>;
  getSessionMessages(baseUrl: string, sessionId: string, directory: string): Promise<any[]>;
  getVcsInfo(baseUrl: string, directory: string): Promise<{ branch?: string; defaultBranch?: string }>;
  getDiff(baseUrl: string, directory: string, mode: 'git' | 'branch'): Promise<any[]>;
  getDiffRaw(baseUrl: string, directory: string): Promise<string>;
}

function transformV1Message(msg: any): any {
  const info = msg.info ?? {};
  const parts = msg.parts ?? [];

  if (info.role === 'user') {
    const textPart = parts.find((p: any) => p.type === 'text');
    return {
      type: 'user',
      id: info.id,
      text: textPart?.text ?? '',
      time: info.time ?? { created: Date.now() },
    };
  }

  if (info.role === 'assistant') {
    const content = parts.map((p: any) => {
      if (p.type === 'text') return { type: 'text', text: p.text ?? '' };
      if (p.type === 'reasoning') return { type: 'reasoning', id: p.id, text: p.text ?? '' };
      if (p.type === 'tool') {
        const st = p.state ?? {};
        return {
          type: 'tool',
          id: p.id,
          name: p.name ?? p.tool ?? '',
          state: st.status
            ? st
            : { status: 'completed', input: {}, content: [] },
          time: p.time ?? { created: Date.now() },
        };
      }
      return null;
    }).filter(Boolean);

    return {
      type: 'assistant',
      id: info.id,
      agent: info.agent ?? '',
      model: info.model ?? { id: '', providerID: '', variant: '' },
      content,
      finish: info.finish ?? 'stop',
      time: info.time ?? { created: Date.now() },
      error: info.error ? { message: typeof info.error.message === 'string' ? info.error.message : JSON.stringify(info.error) } : undefined,
    };
  }

  return null;
}

const realEngine: EngineAdapter = {
  async createWorktree(baseUrl, directory, name?) {
    logger.info(S, 'createWorktree', { baseUrl, directory, name });
    const client = await getClient(baseUrl);
    const result = await client.worktree.create({ directory, worktreeCreateInput: { name } });
    logger.info(S, 'createWorktree response', { data: result.data });
    return result.data as WorktreeInfo;
  },

  async listWorktrees(baseUrl, directory) {
    logger.info(S, 'listWorktrees', { baseUrl, directory });
    const client = await getClient(baseUrl);
    const result = await client.worktree.list({ directory });
    return (result.data as unknown as WorktreeInfo[]) ?? [];
  },

  async removeWorktree(baseUrl, directory, worktreeDirectory) {
    logger.info(S, 'removeWorktree', { baseUrl, directory, worktreeDirectory });
    const client = await getClient(baseUrl);
    await client.worktree.remove({ directory, worktreeRemoveInput: { directory: worktreeDirectory } });
  },

  async createSessionInWorkspace(baseUrl, directory, options) {
    logger.info(S, 'createSessionInWorkspace', { baseUrl, directory, workspaceID: options.workspaceID, title: options.title });
    const client = await getClient(baseUrl);
    const result = await client.session.create({
      directory, title: options.title, agent: options.agent, workspaceID: options.workspaceID,
    });
    logger.info(S, 'createSessionInWorkspace response', { data: result.data });
    return result.data as SessionInfo;
  },

  async sendPrompt(baseUrl, sessionId, text, directory, options?) {
    logger.info(S, 'sendPrompt', { baseUrl, sessionId, directory, text: text.slice(0, 80) });
    const client = await getClient(baseUrl);
    await client.session.promptAsync({
      sessionID: sessionId, directory, workspace: options?.workspace,
      parts: [{ type: 'text' as const, text }],
      ...(options?.agent ? { agent: options.agent } : {}),
    });
    logger.info(S, 'sendPrompt completed', { sessionId });
  },

  async getSessionStatus(baseUrl, directory) {
    const client = await getClient(baseUrl);
    const result = await client.session.status({ directory });
    return result.data;
  },

  async abortSession(baseUrl, sessionId, directory) {
    logger.info(S, 'abortSession', { baseUrl, sessionId, directory });
    const client = await getClient(baseUrl);
    await client.session.abort({ sessionID: sessionId, directory });
  },

  async waitForSessionIdle(baseUrl, sessionId, directory, timeoutMs = 1800000) {
    const client = await getClient(baseUrl);
    logger.info(S, 'waitForSessionIdle — calling v2.session.wait', { sessionId, timeoutMs });

    // 超时保护：防止 session.wait 永远不返回（与 waitForAssistantMessages 一致 30 分钟）
    await Promise.race([
      client.v2.session.wait({ sessionID: sessionId, directory }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Session wait timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);

    logger.info(S, 'waitForSessionIdle done', { sessionId });
  },

  async waitForAssistantMessages(baseUrl, sessionId, directory, targetCount, timeoutMs = 1800000) {
    const POLL_INTERVAL = 3000;
    const client = await getClient(baseUrl);
    const start = Date.now();
    let pollCount = 0;

    while (Date.now() - start < timeoutMs) {
      let count = 0;
      try {
        const result = await client.session.messages({ sessionID: sessionId, directory });
        const messages = (result.data as any[]) ?? [];
        count = messages.filter((m: any) => m.info?.role === 'assistant').length;
      } catch (err: any) {
        logger.warn(S, 'waitForAssistantMessages — poll error, retrying', { sessionId, error: err.message });
        await new Promise((r) => setTimeout(r, POLL_INTERVAL));
        continue;
      }
      pollCount++;

      if (count >= targetCount) {
        logger.info(S, 'waitForAssistantMessages — target reached', { sessionId, count, targetCount, elapsedMs: Date.now() - start });
        return;
      }

      if (pollCount <= 3 || pollCount % 10 === 0) {
        logger.info(S, 'waitForAssistantMessages — polling', { sessionId, count, targetCount, pollCount, elapsedMs: Date.now() - start });
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    }
    throw new Error(`Timed out waiting for ${targetCount} assistant messages after ${timeoutMs}ms`);
  },

  async getSessionMessages(baseUrl, sessionId, directory) {
    const client = await getClient(baseUrl);
    const result = await client.session.messages({ sessionID: sessionId, directory });
    const raw = (result.data as any[]) ?? [];
    return raw.map((msg: any) => transformV1Message(msg)).filter(Boolean);
  },

  /**
   * 轮询 assistant 消息，等待出现包含指定子串的文本。
   *
   * 这是一个通用能力——调用方决定搜什么文本（比如任务完成 marker），
   * 适配器只负责"在 opencode 消息格式中搜索文本"这个与 SDK 强耦合的操作。
   *
   * 搜索范围：所有 assistant 消息的 content[].type === 'text' 的 text 字段。
   */
  async waitForAssistantText(baseUrl, sessionId, directory, substring, timeoutMs = 1800000) {
    const POLL_INTERVAL = 3000;
    const start = Date.now();
    let pollCount = 0;

    while (Date.now() - start < timeoutMs) {
      try {
        const messages = await this.getSessionMessages(baseUrl, sessionId, directory);
        const found = messages
          .filter((m: any) => m.type === 'assistant')
          .flatMap((m: any) => (m.content ?? []).filter((p: any) => p.type === 'text').map((p: any) => p.text as string))
          .some((text: string) => text.includes(substring));

        if (found) {
          logger.info(S, 'waitForAssistantText — substring found', { sessionId, substring: substring.slice(0, 60), elapsedMs: Date.now() - start });
          return;
        }
      } catch (err: any) {
        logger.warn(S, 'waitForAssistantText — poll error, retrying', { sessionId, error: err.message });
      }

      pollCount++;
      if (pollCount <= 3 || pollCount % 10 === 0) {
        logger.info(S, 'waitForAssistantText — polling', { sessionId, substring: substring.slice(0, 60), pollCount, elapsedMs: Date.now() - start });
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    }
    throw new Error(`Timed out waiting for assistant text "${substring.slice(0, 80)}" after ${timeoutMs}ms`);
  },

  async getVcsInfo(baseUrl, directory) {
    const client = await getClient(baseUrl);
    const result = await client.vcs.get({ directory });
    return {
      branch: result.data?.branch,
      defaultBranch: result.data?.default_branch,
    };
  },

  async getDiff(baseUrl, directory, mode) {
    const client = await getClient(baseUrl);
    const result = await client.vcs.diff({ directory, mode });
    return (result.data as any[]) ?? [];
  },

  async getDiffRaw(baseUrl, directory) {
    const client = await getClient(baseUrl);
    const result = await client.vcs.diff2.raw({ directory });
    return (result.data as string) ?? '';
  },
};

const engine: EngineAdapter = isMockEnabled() ? mockEngine : realEngine;

export const createWorktree = engine.createWorktree.bind(engine);
export const listWorktrees = engine.listWorktrees.bind(engine);
export const removeWorktree = engine.removeWorktree.bind(engine);
export const createSessionInWorkspace = engine.createSessionInWorkspace.bind(engine);
export const sendPrompt = engine.sendPrompt.bind(engine);
export const getSessionStatus = engine.getSessionStatus.bind(engine);
export const abortSession = engine.abortSession.bind(engine);
export const waitForSessionIdle = engine.waitForSessionIdle.bind(engine);
export const waitForAssistantMessages = engine.waitForAssistantMessages.bind(engine);
export const waitForAssistantText = engine.waitForAssistantText.bind(engine);
export const getSessionMessages = engine.getSessionMessages.bind(engine);
export const getVcsInfo = engine.getVcsInfo.bind(engine);
export const getDiff = engine.getDiff.bind(engine);
export const getDiffRaw = engine.getDiffRaw.bind(engine);
