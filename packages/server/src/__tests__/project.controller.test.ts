import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../modules/project/project.service', () => ({
  getById: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../modules/project/project.fs', () => ({
  checkDir: vi.fn(),
  ensureDir: vi.fn(),
}));

import * as Service from '../modules/project/project.service';
import { checkDir } from '../modules/project/project.fs';
import { healthCheck, updateStatus } from '../modules/project/project.controller';

function mockCtx(params = {}) {
  return {
    params,
    request: { body: {} } as any,
    body: null as any,
    status: 200 as number,
  } as any;
}

describe('healthCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 404 if project not found', async () => {
    (Service.getById as any).mockResolvedValue(null);
    const ctx = mockCtx({ id: 'nonexistent' });
    await healthCheck(ctx);
    expect(ctx.status).toBe(404);
    expect(ctx.body.error).toBe('Project not found');
  });

  it('should return project as-is if path is empty', async () => {
    const project = { id: '1', path: '', status: 'ACTIVE' };
    (Service.getById as any).mockResolvedValue(project);
    const ctx = mockCtx({ id: '1' });
    await healthCheck(ctx);
    expect(ctx.body).toEqual(project);
    expect(ctx.body.status).toBe('ACTIVE');
  });

  it('should return project as-is if directory exists', async () => {
    const project = { id: '1', path: '/valid/path', status: 'ACTIVE' };
    (Service.getById as any).mockResolvedValue(project);
    (checkDir as any).mockReturnValue({ exists: true, isGitRepo: true, absolutePath: '/valid/path' });
    const ctx = mockCtx({ id: '1' });
    await healthCheck(ctx);
    expect(ctx.body).toEqual(project);
    expect(ctx.body.status).toBe('ACTIVE');
  });

  it('should set status to ERROR if directory does not exist', async () => {
    const project = { id: '1', path: '/deleted/path', status: 'ACTIVE' };
    const updated = { ...project, status: 'ERROR' };
    (Service.getById as any).mockResolvedValue(project);
    (checkDir as any).mockReturnValue({ exists: false, isGitRepo: false, absolutePath: '/deleted/path' });
    (Service.update as any).mockResolvedValue(updated);
    const ctx = mockCtx({ id: '1' });
    await healthCheck(ctx);
    expect(Service.update).toHaveBeenCalledWith('1', { status: 'ERROR' });
    expect(ctx.body.status).toBe('ERROR');
  });

  it('should set status to ERROR for archived project with missing directory', async () => {
    const project = { id: '2', path: '/gone', status: 'ARCHIVED' };
    const updated = { ...project, status: 'ERROR' };
    (Service.getById as any).mockResolvedValue(project);
    (checkDir as any).mockReturnValue({ exists: false, isGitRepo: false, absolutePath: '/gone' });
    (Service.update as any).mockResolvedValue(updated);
    const ctx = mockCtx({ id: '2' });
    await healthCheck(ctx);
    expect(ctx.body.status).toBe('ERROR');
  });
});

describe('updateStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should accept ERROR as a valid status', async () => {
    const updated = { id: '1', status: 'ERROR' };
    (Service.update as any).mockResolvedValue(updated);
    const ctx = mockCtx({ id: '1' });
    ctx.request.body = { status: 'ERROR' };
    await updateStatus(ctx);
    expect(ctx.body.status).toBe('ERROR');
  });

  it('should reject invalid status', async () => {
    const ctx = mockCtx({ id: '1' });
    ctx.request.body = { status: 'INVALID' };
    await updateStatus(ctx);
    expect(ctx.status).toBe(400);
  });
});
