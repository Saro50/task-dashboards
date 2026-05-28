import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../modules/engine/engine.service', () => ({
  get: vi.fn(),
  upsert: vi.fn(),
  remove: vi.fn(),
  getBaseUrl: vi.fn(),
}));

vi.mock('../modules/engine/opencode', () => ({
  healthCheck: vi.fn(),
  listAgents: vi.fn(),
  listProviders: vi.fn(),
  getConfig: vi.fn(),
}));

import * as Service from '../modules/engine/engine.service';
import * as Opencode from '../modules/engine/opencode';
import {
  getConfig,
  upsertConfig,
  removeConfig,
  healthCheck,
  listAgents,
  listProviders,
  getOpencodeConfig,
} from '../modules/engine/engine.controller';

function mockCtx() {
  return {
    params: {},
    request: { body: {} } as any,
    body: null as any,
    status: 200 as number,
  } as any;
}

const mockConfig = { id: 'default', baseUrl: 'http://localhost:4096', createdAt: new Date(), updatedAt: new Date() };

describe('engine.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getConfig', () => {
    it('should return config when exists', async () => {
      (Service.get as any).mockResolvedValue(mockConfig);
      const ctx = mockCtx();
      await getConfig(ctx);
      expect(ctx.body).toEqual(mockConfig);
    });

    it('should return 404 when not found', async () => {
      (Service.get as any).mockResolvedValue(null);
      const ctx = mockCtx();
      await getConfig(ctx);
      expect(ctx.status).toBe(404);
    });
  });

  describe('upsertConfig', () => {
    it('should create config with valid baseUrl', async () => {
      (Service.upsert as any).mockResolvedValue(mockConfig);
      const ctx = mockCtx();
      ctx.request.body = { baseUrl: 'http://localhost:4096' };
      await upsertConfig(ctx);
      expect(ctx.body).toEqual(mockConfig);
    });

    it('should reject missing baseUrl', async () => {
      const ctx = mockCtx();
      ctx.request.body = {};
      await upsertConfig(ctx);
      expect(ctx.status).toBe(400);
    });

    it('should reject invalid URL', async () => {
      const ctx = mockCtx();
      ctx.request.body = { baseUrl: 'not-a-url' };
      await upsertConfig(ctx);
      expect(ctx.status).toBe(400);
    });

    it('should reject empty string', async () => {
      const ctx = mockCtx();
      ctx.request.body = { baseUrl: '' };
      await upsertConfig(ctx);
      expect(ctx.status).toBe(400);
    });
  });

  describe('removeConfig', () => {
    it('should return 204 on success', async () => {
      (Service.remove as any).mockResolvedValue(mockConfig);
      const ctx = mockCtx();
      await removeConfig(ctx);
      expect(ctx.status).toBe(204);
    });

    it('should return 404 when not found', async () => {
      const err = new Error('Not found');
      (err as any).code = 'P2025';
      (Service.remove as any).mockRejectedValue(err);
      const ctx = mockCtx();
      await removeConfig(ctx);
      expect(ctx.status).toBe(404);
    });
  });

  describe('healthCheck', () => {
    it('should return healthy on success', async () => {
      (Service.getBaseUrl as any).mockResolvedValue('http://localhost:4096');
      (Opencode.healthCheck as any).mockResolvedValue(undefined);
      const ctx = mockCtx();
      await healthCheck(ctx);
      expect(ctx.body).toEqual({ healthy: true });
    });

    it('should return 502 on connection failure', async () => {
      (Service.getBaseUrl as any).mockResolvedValue('http://localhost:4096');
      (Opencode.healthCheck as any).mockRejectedValue(new Error('Connection refused'));
      const ctx = mockCtx();
      await healthCheck(ctx);
      expect(ctx.status).toBe(502);
    });
  });

  describe('listAgents', () => {
    it('should return agents list', async () => {
      (Service.getBaseUrl as any).mockResolvedValue('http://localhost:4096');
      (Opencode.listAgents as any).mockResolvedValue({ data: [{ id: 'agent-1', name: 'coder' }] });
      const ctx = mockCtx();
      await listAgents(ctx);
      expect(ctx.body).toEqual([{ id: 'agent-1', name: 'coder' }]);
    });

    it('should return 502 on failure', async () => {
      (Service.getBaseUrl as any).mockResolvedValue('http://localhost:4096');
      (Opencode.listAgents as any).mockRejectedValue(new Error('fail'));
      const ctx = mockCtx();
      await listAgents(ctx);
      expect(ctx.status).toBe(502);
    });
  });

  describe('listProviders', () => {
    it('should return providers list', async () => {
      (Service.getBaseUrl as any).mockResolvedValue('http://localhost:4096');
      (Opencode.listProviders as any).mockResolvedValue({ data: { providers: [], default: {} } });
      const ctx = mockCtx();
      await listProviders(ctx);
      expect(ctx.body).toEqual({ providers: [], default: {} });
    });
  });

  describe('getOpencodeConfig', () => {
    it('should return opencode config', async () => {
      (Service.getBaseUrl as any).mockResolvedValue('http://localhost:4096');
      (Opencode.getConfig as any).mockResolvedValue({ data: { model: 'gpt-4' } });
      const ctx = mockCtx();
      await getOpencodeConfig(ctx);
      expect(ctx.body).toEqual({ model: 'gpt-4' });
    });

    it('should return 502 on failure', async () => {
      (Service.getBaseUrl as any).mockResolvedValue('http://localhost:4096');
      (Opencode.getConfig as any).mockRejectedValue(new Error('fail'));
      const ctx = mockCtx();
      await getOpencodeConfig(ctx);
      expect(ctx.status).toBe(502);
    });
  });
});
