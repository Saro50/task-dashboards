import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../modules/execution/execution.service.js', () => ({
  start: vi.fn(),
  stop: vi.fn(),
  merge: vi.fn(),
  getStatus: vi.fn(),
  getByTask: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  reqLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import * as Service from '../modules/execution/execution.service.js';
import { start, stop, merge, status, list } from '../modules/execution/execution.controller.js';

function mockCtx(overrides?: { params?: any; body?: any }) {
  return {
    params: overrides?.params ?? {},
    request: { body: overrides?.body ?? {} } as any,
    body: null as any,
    status: 200 as number,
    state: { requestId: 'test-req-id' },
  } as any;
}

const mockExecution = {
  id: 'exec-1',
  taskId: 'topic-1',
  projectId: 'proj-1',
  status: 'CREATING_WORKTREE',
  worktreeName: null,
  worktreeDirectory: null,
  sessionId: null,
  targetBranch: null,
  maxConcurrency: 2,
  completedSteps: 0,
  totalSteps: 3,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('execution.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('start', () => {
    it('C7.1: should return 201 on success', async () => {
      (Service.start as any).mockResolvedValue(mockExecution);
      const ctx = mockCtx({
        params: { taskId: 'topic-1' },
        body: { projectId: 'proj-1', maxConcurrency: 2 },
      });

      await start(ctx);

      expect(ctx.status).toBe(201);
      expect(ctx.body).toEqual(mockExecution);
      expect(Service.start).toHaveBeenCalledWith('topic-1', 'proj-1', 2);
    });

    it('C7.2: should return 409 when already running', async () => {
      (Service.start as any).mockRejectedValue(new Error('An execution is already running for this topic'));
      const ctx = mockCtx({
        params: { taskId: 'topic-1' },
        body: { projectId: 'proj-1' },
      });

      await start(ctx);

      expect(ctx.status).toBe(409);
      expect(ctx.body.error).toContain('already running');
    });

    it('C7.3: should return 400 when no pending tasks', async () => {
      (Service.start as any).mockRejectedValue(new Error('No pending tasks to execute'));
      const ctx = mockCtx({
        params: { taskId: 'topic-1' },
        body: { projectId: 'proj-1' },
      });

      await start(ctx);

      expect(ctx.status).toBe(400);
      expect(ctx.body.error).toContain('No pending');
    });

    it('C7.4: should throw on other errors', async () => {
      (Service.start as any).mockRejectedValue(new Error('Topic not found'));
      const ctx = mockCtx({
        params: { taskId: 'bad' },
        body: { projectId: 'proj-1' },
      });

      await expect(start(ctx)).rejects.toThrow('Topic not found');
    });

    it('C7.5: should handle missing body gracefully', async () => {
      (Service.start as any).mockRejectedValue(new Error('Project not found'));
      const ctx = mockCtx({ params: { taskId: 'topic-1' } });

      await expect(start(ctx)).rejects.toThrow();
    });
  });

  describe('stop', () => {
    it('C7.6: should return 200 on success', async () => {
      const stopped = { ...mockExecution, status: 'STOPPED' };
      (Service.stop as any).mockResolvedValue(stopped);
      const ctx = mockCtx({ params: { executionId: 'exec-1' } });

      await stop(ctx);

      expect(ctx.status).toBe(200);
      expect(ctx.body.status).toBe('STOPPED');
    });

    it('C7.7: should return 404 when not found', async () => {
      (Service.stop as any).mockRejectedValue(new Error('Execution not found'));
      const ctx = mockCtx({ params: { executionId: 'bad' } });

      await stop(ctx);

      expect(ctx.status).toBe(404);
    });

    it('C7.8: should return 400 when not running', async () => {
      (Service.stop as any).mockRejectedValue(new Error('Execution is not running'));
      const ctx = mockCtx({ params: { executionId: 'exec-1' } });

      await stop(ctx);

      expect(ctx.status).toBe(400);
    });
  });

  describe('merge', () => {
    it('C7.9: should return 200 on success', async () => {
      const merged = { ...mockExecution, status: 'MERGED', targetBranch: 'main' };
      (Service.merge as any).mockResolvedValue(merged);
      const ctx = mockCtx({
        params: { executionId: 'exec-1' },
        body: { targetBranch: 'main' },
      });

      await merge(ctx);

      expect(ctx.status).toBe(200);
      expect(ctx.body.status).toBe('MERGED');
      expect(Service.merge).toHaveBeenCalledWith('exec-1', 'main');
    });

    it('C7.10: should return 400 when targetBranch missing', async () => {
      const ctx = mockCtx({
        params: { executionId: 'exec-1' },
        body: {},
      });

      await merge(ctx);

      expect(ctx.status).toBe(400);
      expect(ctx.body.error).toContain('required');
    });

    it('C7.11: should return 400 when targetBranch is empty string', async () => {
      const ctx = mockCtx({
        params: { executionId: 'exec-1' },
        body: { targetBranch: '' },
      });

      await merge(ctx);

      expect(ctx.status).toBe(400);
    });

    it('C7.12: should return 400 when not COMPLETED', async () => {
      (Service.merge as any).mockRejectedValue(new Error('Execution must be COMPLETED to merge'));
      const ctx = mockCtx({
        params: { executionId: 'exec-1' },
        body: { targetBranch: 'main' },
      });

      await merge(ctx);

      expect(ctx.status).toBe(400);
    });

    it('C7.13: should return 404 when not found', async () => {
      (Service.merge as any).mockRejectedValue(new Error('Execution not found'));
      const ctx = mockCtx({
        params: { executionId: 'bad' },
        body: { targetBranch: 'main' },
      });

      await merge(ctx);

      expect(ctx.status).toBe(404);
    });
  });

  describe('status', () => {
    it('C7.14: should return latest execution', async () => {
      (Service.getStatus as any).mockResolvedValue(mockExecution);
      const ctx = mockCtx({ params: { taskId: 'topic-1' } });

      await status(ctx);

      expect(ctx.body).toEqual(mockExecution);
      expect(Service.getStatus).toHaveBeenCalledWith('topic-1');
    });

    it('C7.15: should return null when no executions', async () => {
      (Service.getStatus as any).mockResolvedValue(null);
      const ctx = mockCtx({ params: { taskId: 'topic-1' } });

      await status(ctx);

      expect(ctx.body).toBeNull();
    });
  });

  describe('list', () => {
    it('C7.16: should return all executions', async () => {
      const execs = [mockExecution];
      (Service.getByTask as any).mockResolvedValue(execs);
      const ctx = mockCtx({ params: { taskId: 'task-1' } });

      await list(ctx);

      expect(ctx.body).toEqual({ data: execs });
      expect(Service.getByTask).toHaveBeenCalledWith('task-1');
    });
  });
});
