import * as Opencode from '../engine/opencode.js';
import * as EngineService from '../engine/engine.service.js';
import { logger } from '../../logger.js';

const S = 'chat.service';

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

export async function sendMessage(sessionId: string, text: string, directory?: string) {
  const baseUrl = await getBaseUrl();
  logger.info(S, 'sendMessage calling sendPromptAsync', { baseUrl, sessionId, directory, text: text.slice(0, 80) });
  try {
    const result = await Opencode.sendPromptAsync(baseUrl, sessionId, text, directory);
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
