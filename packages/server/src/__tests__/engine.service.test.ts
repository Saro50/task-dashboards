import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEngineConfig } = vi.hoisted(() => ({
  mockEngineConfig: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../prisma', () => ({
  default: {
    engineConfig: mockEngineConfig,
  },
}));

import * as Service from '../modules/engine/engine.service';

const mockConfig = { id: 'default', baseUrl: 'http://localhost:4096', createdAt: new Date(), updatedAt: new Date() };

describe('engine.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('get', () => {
    it('should return config when exists', async () => {
      mockEngineConfig.findUnique.mockResolvedValue(mockConfig);
      const result = await Service.get();
      expect(result).toEqual(mockConfig);
      expect(mockEngineConfig.findUnique).toHaveBeenCalledWith({ where: { id: 'default' } });
    });

    it('should return null when not exists', async () => {
      mockEngineConfig.findUnique.mockResolvedValue(null);
      const result = await Service.get();
      expect(result).toBeNull();
    });
  });

  describe('upsert', () => {
    it('should create config if not exists', async () => {
      mockEngineConfig.upsert.mockResolvedValue(mockConfig);
      const result = await Service.upsert({ baseUrl: 'http://localhost:4096' });
      expect(result).toEqual(mockConfig);
      expect(mockEngineConfig.upsert).toHaveBeenCalledWith({
        where: { id: 'default' },
        update: { baseUrl: 'http://localhost:4096' },
        create: { id: 'default', baseUrl: 'http://localhost:4096' },
      });
    });

    it('should update config if exists', async () => {
      const updated = { ...mockConfig, baseUrl: 'http://new-host:8080' };
      mockEngineConfig.upsert.mockResolvedValue(updated);
      const result = await Service.upsert({ baseUrl: 'http://new-host:8080' });
      expect(result.baseUrl).toBe('http://new-host:8080');
    });
  });

  describe('remove', () => {
    it('should delete config', async () => {
      mockEngineConfig.delete.mockResolvedValue(mockConfig);
      await Service.remove();
      expect(mockEngineConfig.delete).toHaveBeenCalledWith({ where: { id: 'default' } });
    });

    it('should throw P2025 when not found', async () => {
      const err = new Error('Not found');
      (err as any).code = 'P2025';
      mockEngineConfig.delete.mockRejectedValue(err);
      await expect(Service.remove()).rejects.toThrow();
    });
  });

  describe('getBaseUrl', () => {
    it('should return DB config baseUrl when exists', async () => {
      mockEngineConfig.findUnique.mockResolvedValue(mockConfig);
      const url = await Service.getBaseUrl();
      expect(url).toBe('http://localhost:4096');
    });

    it('should fall back to env var when DB config missing', async () => {
      mockEngineConfig.findUnique.mockResolvedValue(null);
      process.env.OPENCODE_BASE_URL = 'http://env-host:5096';
      const url = await Service.getBaseUrl();
      expect(url).toBe('http://env-host:5096');
      delete process.env.OPENCODE_BASE_URL;
    });

    it('should fall back to default when no config and no env', async () => {
      mockEngineConfig.findUnique.mockResolvedValue(null);
      const original = process.env.OPENCODE_BASE_URL;
      delete process.env.OPENCODE_BASE_URL;
      const url = await Service.getBaseUrl();
      expect(url).toBe('http://localhost:4096');
      if (original) process.env.OPENCODE_BASE_URL = original;
    });
  });
});
