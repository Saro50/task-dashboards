import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk';
import { logger } from '../../logger.js';
import type { MessagePartInput } from '../chat/types.js';

const S = 'opencode';

let _client: OpencodeClient | null = null;
let _baseUrl: string | null = null;

async function getClient(baseUrl: string) {
  if (_client && _baseUrl === baseUrl) return _client;
  logger.info(S, 'getClient creating new client', { baseUrl });
  _client = createOpencodeClient({ baseUrl });
  _baseUrl = baseUrl;
  logger.info(S, 'getClient client created');
  return _client;
}

export function resetClient() {
  _client = null;
  _baseUrl = null;
}

export async function healthCheck(baseUrl: string) {
  logger.info(S, 'healthCheck', { baseUrl });
  const client = await getClient(baseUrl);
  
  await client.app.agents();
  logger.info(S, 'healthCheck passed');
}

export async function listAgents(baseUrl: string) {
  logger.info(S, 'listAgents', { baseUrl });
  const client = await getClient(baseUrl);
  const result = client.app.agents();
  logger.info(S, 'listAgents completed');
  return result;
}

export async function listProviders(baseUrl: string) {
  logger.info(S, 'listProviders', { baseUrl });
  const client = await getClient(baseUrl);
  const result = client.config.providers();
  logger.info(S, 'listProviders completed');
  return result;
}

export async function getConfig(baseUrl: string) {
  logger.info(S, 'getConfig', { baseUrl });
  const client = await getClient(baseUrl);
  const result = client.config.get();
  logger.info(S, 'getConfig completed');
  return result;
}

export async function listSessions(baseUrl: string, directory?: string) {
  logger.info(S, 'listSessions', { baseUrl, directory });
  const client = await getClient(baseUrl);
  const result = await client.session.list({ query: { directory } });
  logger.info(S, 'listSessions response', { count: result?.data?.length });
  return result;
}

export async function createSession(baseUrl: string, directory?: string, title?: string) {
  logger.info(S, 'createSession', { baseUrl, directory, title });
  const client = await getClient(baseUrl);
  const result = await client.session.create({ body: { title }, query: { directory } });
  logger.info(S, 'createSession result', { id: result?.data?.id, title: result?.data?.title });
  return result;
}

export async function getSessionMessages(baseUrl: string, sessionId: string, directory?: string) {
  logger.info(S, 'getSessionMessages', { baseUrl, sessionId, directory });
  const client = await getClient(baseUrl);
  const result = await client.session.messages({ path: { id: sessionId }, query: { directory } });
  logger.info(S, 'getSessionMessages response', { count: result?.data?.length });
  return result;
}

/**
 * 发送消息到 opencode 会话（异步）。
 *
 * @param parts    消息 parts 数组，支持 text / file 类型混合。
 *                 直接透传给 SDK 的 client.session.promptAsync，
 *                 其中 file part 的 url 应为相对于工作目录的文件路径。
 */
export async function sendPromptAsync(
  baseUrl: string,
  sessionId: string,
  parts: MessagePartInput[],
  directory?: string,
  agent?: string,
) {
  const partSummary = parts.map((p) =>
    p.type === 'text' ? `text(${p.text.slice(0, 40)})` : `file(${p.mime}, ${p.url})`,
  );
  logger.info(S, 'sendPromptAsync', { baseUrl, sessionId, directory, agent, parts: partSummary });
  const client = await getClient(baseUrl);
  const result = await client.session.promptAsync({
    path: { id: sessionId },
    body: { parts, ...(agent ? { agent } : {}) },
    query: { directory },
  });
  logger.info(S, 'sendPromptAsync completed');
  return result;
}

export async function abortSession(baseUrl: string, sessionId: string, directory?: string) {
  logger.info(S, 'abortSession', { baseUrl, sessionId, directory });
  const client = await getClient(baseUrl);
  const result = await client.session.abort({ path: { id: sessionId }, query: { directory } });
  logger.info(S, 'abortSession completed');
  return result;
}

export async function getSessionStatus(baseUrl: string, directory?: string) {
  logger.info(S, 'getSessionStatus', { baseUrl, directory });
  const client = await getClient(baseUrl);
  const result = await client.session.status({ query: { directory } });
  logger.info(S, 'getSessionStatus result', result?.data);
  return result;
}

export async function subscribeEvents(baseUrl: string, directory?: string): Promise<{ stream: AsyncGenerator<any> }> {
  logger.info(S, 'subscribeEvents', { baseUrl, directory });
  const client = await getClient(baseUrl);
  const result = await client.event.subscribe({ query: { directory } });
  logger.info(S, 'subscribeEvents stream obtained');
  return result as { stream: AsyncGenerator<any> };
}

export async function updateSession(baseUrl: string, sessionId: string, title: string, directory?: string) {
  logger.info(S, 'updateSession', { baseUrl, sessionId, title, directory });
  const client = await getClient(baseUrl);
  const result = await client.session.update({ path: { id: sessionId }, body: { title }, query: { directory } });
  logger.info(S, 'updateSession result', { id: result?.data?.id, title: result?.data?.title });
  return result;
}

export async function deleteSession(baseUrl: string, sessionId: string, directory?: string) {
  logger.info(S, 'deleteSession', { baseUrl, sessionId, directory });
  const client = await getClient(baseUrl);
  const result = await client.session.delete({ path: { id: sessionId }, query: { directory } });
  logger.info(S, 'deleteSession completed', { sessionId });
  return result;
}
