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
  waitForSessionIdle(baseUrl: string, sessionId: string, directory: string): Promise<void>;
  getSessionMessages(baseUrl: string, sessionId: string, directory: string): Promise<any[]>;
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

  async waitForSessionIdle(baseUrl, sessionId, directory) {
    logger.info(S, 'waitForSessionIdle start', { baseUrl, sessionId, directory });
    const client = await getClient(baseUrl);
    await client.v2.session.wait({ sessionID: sessionId, directory });
    logger.info(S, 'waitForSessionIdle done', { sessionId });
  },

  async getSessionMessages(baseUrl, sessionId, directory) {
    const client = await getClient(baseUrl);
    const result = await client.session.messages({ sessionID: sessionId, directory });
    return (result.data as any[]) ?? [];
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
export const getSessionMessages = engine.getSessionMessages.bind(engine);
