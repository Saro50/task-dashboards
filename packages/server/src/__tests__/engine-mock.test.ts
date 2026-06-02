import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { MockEngine } from '../modules/engine/engine-mock.js';

describe('engine-mock', () => {
  let engine: MockEngine;

  const BASE_URL = 'http://localhost:4096';
  const DIRECTORY = '/tmp/test-project';

  beforeEach(() => {
    engine = new MockEngine();
  });

  describe('M1: createWorktree', () => {
    it('should return correct structure with name, branch, directory', async () => {
      const wt = await engine.createWorktree(BASE_URL, DIRECTORY, 'my-wt');

      expect(wt.name).toBe('my-wt');
      expect(wt.branch).toBe('opencode/my-wt');
      expect(wt.directory).toContain('my-wt');
      expect(wt.directory).toContain('/tmp/mock-worktree/');
    });

    it('should generate name when not provided', async () => {
      const wt = await engine.createWorktree(BASE_URL, DIRECTORY);
      expect(wt.name).toBeTruthy();
      expect(wt.branch).toContain('opencode/');
    });
  });

  describe('M2: sendPrompt + waitForSessionIdle generate message pairs', () => {
    it('should generate user+assistant pair for each prompt', async () => {
      const session = await engine.createSessionInWorkspace(BASE_URL, DIRECTORY, { title: 'test' });

      await engine.sendPrompt(BASE_URL, session.id, 'task A', DIRECTORY);
      await engine.sendPrompt(BASE_URL, session.id, 'task B', DIRECTORY);
      await engine.waitForSessionIdle(BASE_URL, session.id, DIRECTORY);

      const messages = await engine.getSessionMessages(BASE_URL, session.id, DIRECTORY);
      expect(messages).toHaveLength(4);
      expect(messages[0].role).toBe('user');
      expect(messages[1].role).toBe('assistant');
      expect(messages[2].role).toBe('user');
      expect(messages[3].role).toBe('assistant');
    });

    it('should return empty messages for unknown session', async () => {
      const messages = await engine.getSessionMessages(BASE_URL, 'unknown', DIRECTORY);
      expect(messages).toEqual([]);
    });
  });

  describe('M3: abortSession interrupts waitForSessionIdle', () => {
    it('should reject waitForSessionIdle when abort is called', async () => {
      const eng = new MockEngine({ taskDelay: 5000 });
      const session = await eng.createSessionInWorkspace(BASE_URL, DIRECTORY, {});
      await eng.sendPrompt(BASE_URL, session.id, 'task', DIRECTORY);

      const waitPromise = eng.waitForSessionIdle(BASE_URL, session.id, DIRECTORY);

      await new Promise((r) => setTimeout(r, 50));
      await eng.abortSession(BASE_URL, session.id, DIRECTORY);

      await expect(waitPromise).rejects.toThrow('Session aborted');
    });

    it('should throw when sending prompt to aborted session', async () => {
      const session = await engine.createSessionInWorkspace(BASE_URL, DIRECTORY, {});
      await engine.abortSession(BASE_URL, session.id, DIRECTORY);

      await expect(
        engine.sendPrompt(BASE_URL, session.id, 'task', DIRECTORY),
      ).rejects.toThrow('Session already aborted');
    });
  });

  describe('M4: failAfter per-session counting', () => {
    it('should fail after N successes', async () => {
      const eng = new MockEngine({ failAfter: 2, taskDelay: 10 });
      const session = await eng.createSessionInWorkspace(BASE_URL, DIRECTORY, {});

      for (let i = 0; i < 4; i++) {
        await eng.sendPrompt(BASE_URL, session.id, `task ${i}`, DIRECTORY);
      }
      await eng.waitForSessionIdle(BASE_URL, session.id, DIRECTORY);

      const messages = await eng.getSessionMessages(BASE_URL, session.id, DIRECTORY);
      const assistantMsgs = messages.filter((m: any) => m.role === 'assistant');
      expect(assistantMsgs).toHaveLength(2);
    });
  });

  describe('M5: two sessions have independent failAfter counters', () => {
    it('each session counts successes independently', async () => {
      const eng = new MockEngine({ failAfter: 1, taskDelay: 10 });
      const sessionA = await eng.createSessionInWorkspace(BASE_URL, DIRECTORY, {});
      const sessionB = await eng.createSessionInWorkspace(BASE_URL, DIRECTORY, {});

      await eng.sendPrompt(BASE_URL, sessionA.id, 'A-task-1', DIRECTORY);
      await eng.sendPrompt(BASE_URL, sessionA.id, 'A-task-2', DIRECTORY);
      await eng.waitForSessionIdle(BASE_URL, sessionA.id, DIRECTORY);

      await eng.sendPrompt(BASE_URL, sessionB.id, 'B-task-1', DIRECTORY);
      await eng.waitForSessionIdle(BASE_URL, sessionB.id, DIRECTORY);

      const msgsA = await eng.getSessionMessages(BASE_URL, sessionA.id, DIRECTORY);
      const msgsB = await eng.getSessionMessages(BASE_URL, sessionB.id, DIRECTORY);

      expect(msgsA.filter((m: any) => m.role === 'assistant')).toHaveLength(1);
      expect(msgsB.filter((m: any) => m.role === 'assistant')).toHaveLength(1);
    });
  });

  describe('M6: taskDelay=0 resolves immediately', () => {
    it('should resolve waitForSessionIdle without error when delay is 0', async () => {
      const eng = new MockEngine({ taskDelay: 0, wtDelay: 0, sessionDelay: 0 });
      const session = await eng.createSessionInWorkspace(BASE_URL, DIRECTORY, {});
      await eng.sendPrompt(BASE_URL, session.id, 'task', DIRECTORY);

      const start = Date.now();
      await eng.waitForSessionIdle(BASE_URL, session.id, DIRECTORY);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('M7: abortCallbacks cleanup after normal completion', () => {
    it('should have completed successfully after waitForSessionIdle resolves', async () => {
      const eng = new MockEngine({ taskDelay: 10 });
      const session = await eng.createSessionInWorkspace(BASE_URL, DIRECTORY, {});
      await eng.sendPrompt(BASE_URL, session.id, 'task', DIRECTORY);
      await eng.waitForSessionIdle(BASE_URL, session.id, DIRECTORY);

      const msgs = await eng.getSessionMessages(BASE_URL, session.id, DIRECTORY);
      expect(msgs.some((m: any) => m.role === 'assistant')).toBe(true);
    });
  });

  describe('M8: removeWorktree', () => {
    it('should remove worktree from list', async () => {
      const wt = await engine.createWorktree(BASE_URL, DIRECTORY, 'to-remove');

      const before = await engine.listWorktrees(BASE_URL, DIRECTORY);
      expect(before.some((w) => w.directory === wt.directory)).toBe(true);

      await engine.removeWorktree(BASE_URL, DIRECTORY, wt.directory);

      const after = await engine.listWorktrees(BASE_URL, DIRECTORY);
      expect(after.some((w) => w.directory === wt.directory)).toBe(false);
    });
  });
});
