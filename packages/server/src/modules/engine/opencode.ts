type OpencodeClient = ReturnType<typeof import('@opencode-ai/sdk')['createOpencodeClient']>;

export async function createClient(baseUrl: string) {
  const { createOpencodeClient } = await import('@opencode-ai/sdk');
  return createOpencodeClient({ baseUrl });
}

export async function healthCheck(baseUrl: string) {
  const client = await createClient(baseUrl);
  return client.global.health();
}

export async function listAgents(baseUrl: string) {
  const client = await createClient(baseUrl);
  return client.app.agents();
}

export async function listProviders(baseUrl: string) {
  const client = await createClient(baseUrl);
  return client.config.providers();
}

export async function getConfig(baseUrl: string) {
  const client = await createClient(baseUrl);
  return client.config.get();
}
