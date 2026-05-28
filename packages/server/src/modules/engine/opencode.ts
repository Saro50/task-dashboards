import type { OpencodeClient } from '@opencode-ai/sdk';

let _client: OpencodeClient | null = null;
let _baseUrl: string | null = null;

async function getClient(baseUrl: string) {
  if (_client && _baseUrl === baseUrl) return _client;
  const { createOpencodeClient } = await import('@opencode-ai/sdk');
  _client = createOpencodeClient({ baseUrl });
  _baseUrl = baseUrl;
  return _client;
}

export function resetClient() {
  _client = null;
  _baseUrl = null;
}

export async function healthCheck(baseUrl: string) {
  const client = await getClient(baseUrl);
  await client.app.agents();
}

export async function listAgents(baseUrl: string) {
  const client = await getClient(baseUrl);
  return client.app.agents();
}

export async function listProviders(baseUrl: string) {
  const client = await getClient(baseUrl);
  return client.config.providers();
}

export async function getConfig(baseUrl: string) {
  const client = await getClient(baseUrl);
  return client.config.get();
}
