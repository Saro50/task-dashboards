declare module '@opencode-ai/sdk' {
  interface OpencodeClient {
    global: {
      health(): Promise<{ data: { healthy: boolean; version: string } }>;
    };
    app: {
      agents(): Promise<{ data: Array<{ id: string; name: string; description?: string }> }>;
    };
    config: {
      get(): Promise<{ data: Record<string, unknown> }>;
      providers(): Promise<{ data: { providers: Array<{ id: string; name: string; models: string[] }>; default: Record<string, string> } }>;
    };
  }

  export function createOpencodeClient(options: { baseUrl: string }): OpencodeClient;
}
