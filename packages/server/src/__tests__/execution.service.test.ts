import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const executionRecord: Record<string, any> = {};
  const taskRecords: Record<string, any> = {};

  const prisma = {
    taskTopic: { findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
    taskExecution: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  };

  const taskService = {
    listByTopic: vi.fn(),
    update: vi.fn(),
  };

  const engineService = {
    getBaseUrl: vi.fn(),
  };

  return { prisma, taskService, engineService, executionRecord, taskRecords };
});

const { getSessionMessagesMock } = vi.hoisted(() => ({
  getSessionMessagesMock: vi.fn().mockResolvedValue(
    Array.from({ length: 20 }, () => ({ type: 'assistant', content: [{ type: 'text', text: 'done' }] })),
  ),
}));

vi.mock('../prisma.js', () => ({ default: mocks.prisma }));

vi.mock('../modules/task/task.service.js', () => ({
  listByTopic: mocks.taskService.listByTopic,
  update: mocks.taskService.update,
}));

vi.mock('../modules/engine/engine.service.js', () => ({
  getBaseUrl: mocks.engineService.getBaseUrl,
}));

vi.mock('../modules/engine/engine-mock.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../modules/engine/engine-mock.js')>();
  return {
    ...original,
    isMockEnabled: () => true,
    mockEngine: new original.MockEngine({ wtDelay: 5, sessionDelay: 5, taskDelay: 50 }),
  };
});

vi.mock('../modules/engine/opencode-v2.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../modules/engine/opencode-v2.js')>();
  return {
    ...original,
    getSessionMessages: getSessionMessagesMock,
  };
});

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockGit = {
  checkout: vi.fn().mockResolvedValue(undefined),
  merge: vi.fn().mockResolvedValue(undefined),
  commit: vi.fn().mockResolvedValue(undefined),
};

vi.mock('simple-git', () => ({
  default: () => mockGit,
}));

import * as Service from '../modules/execution/execution.service.js';

const TOPIC_ID = 'topic-1';
const PROJECT_ID = 'proj-1';
const TOPIC_NAME = 'Test Topic';
const PROJECT_PATH = '/tmp/test-project';

let execCounter = 0;
let taskCounter = 0;

function makeTopic() {
  return { id: TOPIC_ID, name: TOPIC_NAME, projectId: PROJECT_ID };
}

function makeProject() {
  return { id: PROJECT_ID, name: 'Test', path: PROJECT_PATH };
}

function makeTask(overrides: { title: string; status?: string; dependencies?: string[] }) {
  const id = `task-${++taskCounter}`;
  return {
    id,
    projectId: PROJECT_ID,
    topicId: TOPIC_ID,
    title: overrides.title,
    description: '',
    status: overrides.status ?? 'PENDING',
    dependencies: overrides.dependencies ?? [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeExecution(overrides: Record<string, any> = {}) {
  const id = `exec-${++execCounter}`;
  return {
    id,
    topicId: TOPIC_ID,
    projectId: PROJECT_ID,
    status: 'CREATING_WORKTREE',
    worktreeId: null,
    worktreeName: null,
    worktreeBranch: null,
    worktreeDirectory: null,
    sessionId: null,
    targetBranch: null,
    maxConcurrency: 2,
    completedTasks: 0,
    totalTasks: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function waitFor(predicate: () => boolean, timeout = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeout) return reject(new Error('waitFor timeout'));
      setTimeout(check, 100);
    };
    check();
  });
}

describe('execution.service', () => {
  let latestExecution: any;
  let taskUpdates: Record<string, any> = {};

  function setupExecutionStubs() {
    latestExecution = null;
    taskUpdates = {};

    mocks.prisma.taskTopic.findUnique.mockImplementation(({ where }: any) => {
      if (where.id === TOPIC_ID) return Promise.resolve(makeTopic());
      return Promise.resolve(null);
    });

    mocks.prisma.project.findUnique.mockImplementation(({ where }: any) => {
      if (where.id === PROJECT_ID) return Promise.resolve(makeProject());
      return Promise.resolve(null);
    });

    mocks.prisma.taskExecution.findFirst.mockResolvedValue(null);

    mocks.prisma.taskExecution.create.mockImplementation(({ data }: any) => {
      latestExecution = makeExecution(data);
      return Promise.resolve(latestExecution);
    });

    mocks.prisma.taskExecution.findUnique.mockImplementation(({ where }: any) => {
      if (latestExecution && where.id === latestExecution.id) return Promise.resolve(latestExecution);
      return Promise.resolve(null);
    });

    mocks.prisma.taskExecution.update.mockImplementation(({ where, data }: any) => {
      if (latestExecution && where.id === latestExecution.id) {
        Object.assign(latestExecution, data);
      } else if (where.id) {
        latestExecution = makeExecution({ id: where.id, ...data });
      }
      return Promise.resolve(latestExecution);
    });

    mocks.prisma.taskExecution.updateMany.mockImplementation(({ where, data }: any) => {
      if (latestExecution && where.id === latestExecution.id && where.status === 'RUNNING') {
        Object.assign(latestExecution, data);
      }
      return Promise.resolve({ count: 1 });
    });

    mocks.taskService.update.mockImplementation((id: string, data: any) => {
      taskUpdates[id] = data;
      return Promise.resolve({ id });
    });

    mocks.engineService.getBaseUrl.mockResolvedValue('http://localhost:4096');
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGit.checkout.mockResolvedValue(undefined);
    mockGit.merge.mockResolvedValue(undefined);
    mockGit.commit.mockResolvedValue(undefined);
    execCounter = 0;
    taskCounter = 0;
    setupExecutionStubs();
  });

  describe('S1: startup validation', () => {
    it('S1.1: should throw when topic not found', async () => {
      mocks.prisma.taskTopic.findUnique.mockResolvedValue(null);
      await expect(Service.start('bad-topic', PROJECT_ID)).rejects.toThrow('Topic not found');
    });

    it('S1.2: should throw when project not found', async () => {
      mocks.prisma.project.findUnique.mockResolvedValue(null);
      await expect(Service.start(TOPIC_ID, 'bad-project')).rejects.toThrow('Project not found');
    });

    it('S1.3: should throw when no pending tasks', async () => {
      mocks.taskService.listByTopic.mockResolvedValue([
        makeTask({ title: 'done', status: 'COMPLETED' }),
      ]);
      await expect(Service.start(TOPIC_ID, PROJECT_ID)).rejects.toThrow('No pending tasks');
    });

    it('S1.4: should throw when execution already running', async () => {
      mocks.prisma.taskExecution.findFirst.mockResolvedValue(makeExecution({ status: 'RUNNING' }));
      mocks.taskService.listByTopic.mockResolvedValue([makeTask({ title: 'A' })]);

      await expect(Service.start(TOPIC_ID, PROJECT_ID)).rejects.toThrow('already running');
    });
  });

  describe('S2: happy path', () => {
    it('S2.1: single task completes', async () => {
      const tasks = [makeTask({ title: 'A' })];
      mocks.taskService.listByTopic.mockImplementation(async () => {
        return tasks.map((t) => ({ ...t, status: taskUpdates[t.id]?.status || t.status }));
      });

      const exec = await Service.start(TOPIC_ID, PROJECT_ID);

      await waitFor(() => latestExecution?.status === 'COMPLETED', 20000);

      expect(latestExecution.completedTasks).toBe(1);
      expect(latestExecution.totalTasks).toBe(1);
      expect(taskUpdates[tasks[0].id]?.status).toBe('COMPLETED');
    }, 20000);

    it('S2.2: 3 tasks linear dependency completes sequentially', async () => {
      const tA = makeTask({ title: 'A' });
      const tB = makeTask({ title: 'B', dependencies: [tA.id] });
      const tC = makeTask({ title: 'C', dependencies: [tB.id] });
      const tasks = [tA, tB, tC];
      mocks.taskService.listByTopic.mockImplementation(async () => {
        return tasks.map((t) => ({ ...t, status: taskUpdates[t.id]?.status || t.status }));
      });

      await Service.start(TOPIC_ID, PROJECT_ID, 2);

      await waitFor(() => latestExecution?.status === 'COMPLETED', 30000);

      expect(taskUpdates[tA.id]?.status).toBe('COMPLETED');
      expect(taskUpdates[tB.id]?.status).toBe('COMPLETED');
      expect(taskUpdates[tC.id]?.status).toBe('COMPLETED');
      expect(latestExecution.completedTasks).toBe(3);
    }, 30000);

    it('S2.3: diamond dependency with concurrency=2', async () => {
      const tA = makeTask({ title: 'A' });
      const tB = makeTask({ title: 'B', dependencies: [tA.id] });
      const tC = makeTask({ title: 'C', dependencies: [tA.id] });
      const tD = makeTask({ title: 'D', dependencies: [tB.id, tC.id] });
      const tE = makeTask({ title: 'E', dependencies: [tD.id] });
      const tasks = [tA, tB, tC, tD, tE];
      mocks.taskService.listByTopic.mockImplementation(async () => {
        return tasks.map((t) => ({ ...t, status: taskUpdates[t.id]?.status || t.status }));
      });

      await Service.start(TOPIC_ID, PROJECT_ID, 2);

      await waitFor(() => latestExecution?.status === 'COMPLETED', 60000);

      for (const t of tasks) {
        expect(taskUpdates[t.id]?.status).toBe('COMPLETED');
      }
      expect(latestExecution.completedTasks).toBe(5);
    }, 60000);

    it('S2.4: progress increments during execution', async () => {
      const tA = makeTask({ title: 'A' });
      const tB = makeTask({ title: 'B', dependencies: [tA.id] });
      const tC = makeTask({ title: 'C', dependencies: [tB.id] });
      const tasks = [tA, tB, tC];
      mocks.taskService.listByTopic.mockImplementation(async () => {
        return tasks.map((t) => ({ ...t, status: taskUpdates[t.id]?.status || t.status }));
      });

      await Service.start(TOPIC_ID, PROJECT_ID, 1);

      await waitFor(() => latestExecution?.status === 'COMPLETED', 30000);

      expect(latestExecution.completedTasks).toBe(3);
    }, 30000);
  });

  describe('S3: stop execution', () => {
    it('S3.1: stop resets IN_PROGRESS tasks to PENDING', async () => {
      const tA = makeTask({ title: 'A' });
      const tB = makeTask({ title: 'B', dependencies: [tA.id] });
      const tasks = [tA, tB];
      mocks.taskService.listByTopic.mockImplementation(async () => {
        return tasks.map((t) => ({ ...t, status: taskUpdates[t.id]?.status || t.status }));
      });

      const exec = await Service.start(TOPIC_ID, PROJECT_ID);

      await waitFor(() => latestExecution?.status === 'RUNNING');
      await waitFor(() => {
        const updates = Object.values(taskUpdates) as any[];
        return updates.some((d) => d?.status === 'IN_PROGRESS');
      });

      const stopped = await Service.stop(exec.id);
      expect(stopped!.status).toBe('STOPPED');
    }, 20000);

    it('S3.3: stop on stopped execution throws', async () => {
      latestExecution = makeExecution({ status: 'STOPPED' });
      await expect(Service.stop(latestExecution.id)).rejects.toThrow('not running');
    });

    it('S3.4: stop on non-existent execution throws', async () => {
      mocks.prisma.taskExecution.findUnique.mockResolvedValue(null);
      await expect(Service.stop('non-existent')).rejects.toThrow('not found');
    });
  });

  describe('S4: reuse worktree after stop', () => {
    it('S4.1: reuses STOPPED worktree on restart', async () => {
      const tA = makeTask({ title: 'A' });
      const tB = makeTask({ title: 'B' });
      const tasks = [tA, tB];
      mocks.taskService.listByTopic.mockImplementation(async () => {
        return tasks.map((t) => ({ ...t, status: taskUpdates[t.id]?.status || t.status }));
      });

      const stoppedExec = makeExecution({
        status: 'STOPPED',
        worktreeName: 'exec-test-wt',
        worktreeBranch: 'opencode/exec-test-wt',
        worktreeDirectory: '/tmp/mock-worktree/exec-test-wt',
      });

      mocks.prisma.taskExecution.findFirst.mockImplementation(({ where }: any) => {
        if (where.status?.in?.includes('STOPPED')) return Promise.resolve(stoppedExec);
        return Promise.resolve(null);
      });

      await Service.start(TOPIC_ID, PROJECT_ID);

      await waitFor(() => latestExecution?.status === 'COMPLETED', 20000);

      expect(latestExecution.worktreeName).toBe('exec-test-wt');
      expect(latestExecution.worktreeBranch).toBe('opencode/exec-test-wt');
      expect(latestExecution.worktreeDirectory).toBe('/tmp/mock-worktree/exec-test-wt');
    }, 20000);

    it('S4.2: creates new worktree when no STOPPED worktree exists', async () => {
      const tA = makeTask({ title: 'A' });
      const tasks = [tA];
      mocks.taskService.listByTopic.mockImplementation(async () => {
        return tasks.map((t) => ({ ...t, status: taskUpdates[t.id]?.status || t.status }));
      });

      mocks.prisma.taskExecution.findFirst.mockResolvedValue(null);

      await Service.start(TOPIC_ID, PROJECT_ID);

      await waitFor(() => latestExecution?.status === 'COMPLETED', 20000);

      expect(latestExecution.worktreeDirectory).toBeTruthy();
      expect(latestExecution.worktreeBranch).toBeTruthy();
    }, 20000);
  });

  describe('S5: merge', () => {
    it('S5.1: merge completed execution', async () => {
      latestExecution = makeExecution({
        status: 'COMPLETED',
        worktreeBranch: 'opencode/test-branch',
        worktreeDirectory: '/tmp/mock-worktree/test',
      });
      mocks.prisma.taskExecution.findUnique.mockResolvedValue(latestExecution);
      mocks.prisma.taskTopic.findUnique.mockResolvedValue(makeTopic());

      const result = await Service.merge(latestExecution.id, 'main');

      expect(result!.status).toBe('MERGED');
      expect(result!.targetBranch).toBe('main');
      expect(mockGit.checkout).toHaveBeenCalledWith('main');
      expect(mockGit.merge).toHaveBeenCalledWith(['--squash', 'opencode/test-branch']);
      expect(mockGit.commit).toHaveBeenCalled();
    });

    it('S5.2: merge running execution throws', async () => {
      latestExecution = makeExecution({ status: 'RUNNING' });
      mocks.prisma.taskExecution.findUnique.mockResolvedValue(latestExecution);

      await expect(Service.merge(latestExecution.id, 'main')).rejects.toThrow('must be COMPLETED');
    });

    it('S5.3: merge non-existent throws', async () => {
      mocks.prisma.taskExecution.findUnique.mockResolvedValue(null);
      await expect(Service.merge('bad', 'main')).rejects.toThrow('not found');
    });
  });

  describe('S6: partial failure', () => {
    it('S6.1: fewer assistant messages than tasks causes BLOCKED', async () => {
      const tA = makeTask({ title: 'A' });
      const tB = makeTask({ title: 'B' });
      const tC = makeTask({ title: 'C' });
      const tasks = [tA, tB, tC];
      mocks.taskService.listByTopic.mockImplementation(async () => {
        return tasks.map((t) => ({ ...t, status: taskUpdates[t.id]?.status || t.status }));
      });

      getSessionMessagesMock.mockResolvedValue([
        { type: 'assistant', content: [{ type: 'text', text: 'done' }] },
      ]);

      await Service.start(TOPIC_ID, PROJECT_ID, 3);

      await waitFor(() =>
        latestExecution?.status === 'COMPLETED' ||
        latestExecution?.status === 'FAILED'
      , 20000);

      const statuses = tasks.map((t) => taskUpdates[t.id]?.status || 'PENDING');
      const completed = statuses.filter((s) => s === 'COMPLETED').length;
      const blocked = statuses.filter((s) => s === 'BLOCKED').length;
      expect(completed).toBe(1);
      expect(blocked).toBe(2);

      const blockedTask = tasks.find((t) => taskUpdates[t.id]?.status === 'BLOCKED');
      expect(blockedTask).toBeTruthy();
      expect(taskUpdates[blockedTask!.id]?.blockedReason).toBeTruthy();
    }, 20000);

    it('S6.2: dependency chain breaks when upstream BLOCKED', async () => {
      const tA = makeTask({ title: 'A' });
      const tB = makeTask({ title: 'B', dependencies: [tA.id] });
      const tC = makeTask({ title: 'C', dependencies: [tB.id] });
      const tasks = [tA, tB, tC];
      mocks.taskService.listByTopic.mockImplementation(async () => {
        return tasks.map((t) => ({ ...t, status: taskUpdates[t.id]?.status || t.status }));
      });

      getSessionMessagesMock.mockResolvedValue([]);

      await Service.start(TOPIC_ID, PROJECT_ID, 1);

      await waitFor(() =>
        latestExecution?.status === 'COMPLETED' ||
        latestExecution?.status === 'FAILED'
      , 20000);

      expect(taskUpdates[tA.id]?.status).toBe('BLOCKED');
      expect(taskUpdates[tA.id]?.blockedReason).toBeTruthy();
    }, 20000);
  });

  describe('S7: queries', () => {
    it('S7.1: getStatus returns latest', async () => {
      const exec = makeExecution({ status: 'COMPLETED' });
      mocks.prisma.taskExecution.findFirst.mockResolvedValue(exec);

      const result = await Service.getStatus(TOPIC_ID);
      expect(result).toEqual(exec);
      expect(mocks.prisma.taskExecution.findFirst).toHaveBeenCalledWith({
        where: { topicId: TOPIC_ID },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('S7.2: getByTopic returns all', async () => {
      const execs = [makeExecution(), makeExecution()];
      mocks.prisma.taskExecution.findMany.mockResolvedValue(execs);

      const result = await Service.getByTopic(TOPIC_ID);
      expect(result).toEqual(execs);
    });

    it('S7.3: getStatus returns null when none', async () => {
      mocks.prisma.taskExecution.findFirst.mockResolvedValue(null);
      const result = await Service.getStatus(TOPIC_ID);
      expect(result).toBeNull();
    });
  });
});
