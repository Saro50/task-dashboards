declare module '@opencode-ai/sdk' {
  interface OpencodeClient {
    app: {
      agents(): Promise<{ data: Array<{ id: string; name: string; description?: string }> }>;
    };
    config: {
      get(): Promise<{ data: Record<string, unknown> }>;
      providers(): Promise<{ data: { providers: Array<{ id: string; name: string; models: Record<string, unknown> }>; default: Record<string, string> } }>;
    };
  }

  export function createOpencodeClient(options: { baseUrl: string }): OpencodeClient;
}
