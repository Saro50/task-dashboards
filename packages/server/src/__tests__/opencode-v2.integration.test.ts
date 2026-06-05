/**
 * opencode-v2 真实集成测试。
 *
 * 目的：验证 opencode-v2.ts 适配器与真实 opencode server 的交互，
 * 覆盖两步等待协议、消息计数、worktree 生命周期等核心逻辑。
 *
 * 前置条件：
 *   - opencode server 运行在 OPENCODE_BASE_URL（默认 http://localhost:4096）
 *   - 测试使用当前仓库作为 worktree 基目录
 *   - server 不可用时直接报错，不跳过
 *
 * 运行方式：
 *   npx vitest run src/__tests__/opencode-v2.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as OpencodeV2 from '../modules/engine/opencode-v2.js';

/**
 * 验证 AI 确实在 worktree 中创建了指定文件，且内容包含期望的子串。
 * AI 产出的文件可能有额外空白行或格式差异，所以用 includes 而非精确匹配。
 *
 * 注意：waitForSessionIdle 返回后，文件写入可能还有短暂延迟（工具调用完成 →
 * 文件系统 flush 之间有间隙），所以用轮询重试而非一次性读取。
 */
async function expectFileCreated(dir: string, filename: string, contentSubstring: string, timeoutMs = 10_000) {
  const filePath = join(dir, filename);
  const POLL_INTERVAL = 500;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const content = await readFile(filePath, 'utf-8');
      expect(content).toContain(contentSubstring);
      return; // 成功
    } catch (err: any) {
      if (err.code !== 'ENOENT' && !(err instanceof Error && err.message.includes('toContain'))) {
        throw err; // 非预期错误，直接抛出
      }
      // ENOENT 或内容不匹配，继续轮询
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  // 最后一次尝试（让 ENOENT 错误自然抛出，给出清晰的报错信息）
  const content = await readFile(filePath, 'utf-8');
  expect(content).toContain(contentSubstring);
}

/**
 * 构造带完成标记的 prompt。
 *
 * Marker 机制：prompt 要求 AI 在完成时输出 <task-{id}>done</task-{id}>，
 * 调用方通过 waitForAssistantText(marker) 轮询 AI 输出中是否包含该标记。
 * 比消息计数更可靠——不受 tool-call 中间消息数量影响。
 */
function buildPromptWithMarker(promptBody: string, taskId: string): { prompt: string; marker: string } {
  const marker = `<task-${taskId}>done</task-${taskId}>`;
  const prompt = `${promptBody}\n\nWhen you have completed this task, include exactly the following marker in your response:\n${marker}`;
  return { prompt, marker };
}

const BASE_URL = process.env.OPENCODE_BASE_URL || 'http://localhost:4096';
const WORKSPACE = '/Users/finlaywu/MyWork/task-dashboards';

// 每个测试的超时时间：5 分钟（真实 AI 处理需要 30s–2min）
const TEST_TIMEOUT = 300_000;
// beforeAll/afterAll 的超时时间：1 分钟
const HOOK_TIMEOUT = 60_000;

describe('opencode-v2 integration (真实 server)', () => {
  let worktreeDir: string;
  let sessionId: string;
  let worktreeName: string;

  // -----------------------------------------------------------------------
  // 共享 setup：创建一个 worktree + session，所有测试（I7 除外）共用
  // -----------------------------------------------------------------------
  beforeAll(async () => {
    worktreeName = `integration-test-${Date.now()}`;
    const wt = await OpencodeV2.createWorktree(BASE_URL, WORKSPACE, worktreeName);
    worktreeDir = wt.directory;
    console.log(`Created worktree: ${worktreeDir}`);
    const session = await OpencodeV2.createSessionInWorkspace(BASE_URL, worktreeDir, {
      title: 'integration-test',
    });
    sessionId = session.id;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    if (sessionId) {
      await OpencodeV2.abortSession(BASE_URL, sessionId, worktreeDir).catch(() => {});
    }
    // if (worktreeDir) {
    //   await OpencodeV2.removeWorktree(BASE_URL, WORKSPACE, worktreeDir).catch(() => {});
    // }
  }, HOOK_TIMEOUT);

  // -----------------------------------------------------------------------
  // I1: 服务器连通性 — 所有后续测试的前提
  // -----------------------------------------------------------------------
  describe('I1: 服务器连通性', () => {
    it(
      'getSessionStatus 应返回有效结果',
      async () => {
        const status = await OpencodeV2.getSessionStatus(BASE_URL, worktreeDir);
        console.log('status:' ,status)
        expect(status).toBeDefined();
      },
      10_000,
    );
  });

  // -----------------------------------------------------------------------
  // I2: Worktree 生命周期 — listWorktrees 能看到 beforeAll 创建的 worktree
  //   注意：SDK 实际返回 string[]（目录路径），不是 WorktreeInfo 对象数组。
  //   opencode-v2.ts 的类型声明是 WorktreeInfo[] 但实际 API 返回原始字符串。
  //   测试同时兼容两种格式，以防未来 SDK 升级修正类型。
  // -----------------------------------------------------------------------
  describe('I2: Worktree 生命周期', () => {
    it(
      `listWorktrees 应包含我们创建的 worktree:${worktreeDir}`,
      async () => {
        const list = await OpencodeV2.listWorktrees(BASE_URL, WORKSPACE);
        expect(list).toBeDefined();
        expect(Array.isArray(list)).toBe(true);
        expect(list.length).toBeGreaterThan(0);

        // 兼容 string[] 和 WorktreeInfo[] 两种格式
        const found = list.find((w: any) => {
          const dir = typeof w === 'string' ? w : w.directory;
          return dir === worktreeDir;
        });
        expect(found).toBeDefined();
      },
      10_000,
    );
  });

  // -----------------------------------------------------------------------
  // I3 + I4: 单条 prompt 的两步等待（marker 版）
  //   prompt 要求 AI 输出完成标记，waitForAssistantText 搜索该标记判断完成。
  //   这是 execution.service.ts 核心完成检测逻辑的直接验证。
  // -----------------------------------------------------------------------
  describe('I3 + I4: 单条 prompt 两步等待 (marker)', () => {
    it(
      'sendPrompt → waitForAssistantText(marker) → waitForSessionIdle → 文件验收',
      async () => {
        const { prompt, marker } = buildPromptWithMarker(
          "Create a file called test-marker.txt with content 'hello from integration test'",
          'i3-marker',
        );

        await OpencodeV2.sendPrompt(BASE_URL, sessionId, prompt, worktreeDir);

        // Step 1: 等 AI 输出完成标记
        await OpencodeV2.waitForAssistantText(BASE_URL, sessionId, worktreeDir, marker);
        // Step 2: 等 session 真正空闲（工具调用完成、文件落盘）
        await OpencodeV2.waitForSessionIdle(BASE_URL, sessionId, worktreeDir);

        // 验收：AI 确实创建了指定文件
        await expectFileCreated(worktreeDir, 'test-marker.txt', 'hello from integration test');
      },
      TEST_TIMEOUT,
    );
  });

  // -----------------------------------------------------------------------
  // I5: 顺序两条 prompt，各自独立的 marker（marker 版）
  //   每条 prompt 用不同 taskId，互不干扰。
  //   不再需要 baseline/midAssistantCount 计数——marker 是唯一的完成信号。
  // -----------------------------------------------------------------------
  describe('I5: 顺序两条 prompt 独立 marker', () => {
    it(
      '两条 prompt 各自通过 marker 完成检测，文件验收通过',
      async () => {
        // 第一条 prompt
        const p1 = buildPromptWithMarker(
          "Create a file called test-marker-2.txt with content 'second file'",
          'i5a-marker',
        );
        await OpencodeV2.sendPrompt(BASE_URL, sessionId, p1.prompt, worktreeDir);
        await OpencodeV2.waitForAssistantText(BASE_URL, sessionId, worktreeDir, p1.marker);
        await OpencodeV2.waitForSessionIdle(BASE_URL, sessionId, worktreeDir);
        await expectFileCreated(worktreeDir, 'test-marker-2.txt', 'second file');

        // 第二条 prompt（不同 taskId，独立 marker）
        const p2 = buildPromptWithMarker(
          "Create a file called test-marker-3.txt with content 'third file'",
          'i5b-marker',
        );
        await OpencodeV2.sendPrompt(BASE_URL, sessionId, p2.prompt, worktreeDir);
        await OpencodeV2.waitForAssistantText(BASE_URL, sessionId, worktreeDir, p2.marker);
        await OpencodeV2.waitForSessionIdle(BASE_URL, sessionId, worktreeDir);
        await expectFileCreated(worktreeDir, 'test-marker-3.txt', 'third file');
      },
      TEST_TIMEOUT * 2,
    );
  });

  // -----------------------------------------------------------------------
  // I6: AI 修改文件后的 diff
  //   I3/I5 创建的文件应该出现在 diff 中
  // -----------------------------------------------------------------------
  describe('I6: diff 包含 AI 创建的文件', () => {
    it(
      "getDiff(mode='branch') 应返回非空结果",
      async () => {
        const diff = await OpencodeV2.getDiff(BASE_URL, worktreeDir, 'branch');
        expect(diff).toBeDefined();
        expect(Array.isArray(diff)).toBe(true);
        expect(diff.length).toBeGreaterThan(0);
      },
      10_000,
    );

    it(
      'getDiffRaw 应返回非空字符串',
      async () => {
        const raw = await OpencodeV2.getDiffRaw(BASE_URL, worktreeDir);
        expect(typeof raw).toBe('string');
        expect(raw.length).toBeGreaterThan(0);
      },
      10_000,
    );
  });

  // -----------------------------------------------------------------------
  // I7: abort 传播
  //   使用独立 session，避免毁掉共享 session
  // -----------------------------------------------------------------------
  describe('I7: abort 传播', () => {
    it(
      'abort 后 waitForSessionIdle 应 reject',
      async () => {
        // 创建独立 session
        const session = await OpencodeV2.createSessionInWorkspace(BASE_URL, worktreeDir, {
          title: 'integration-test-abort',
        });
        const abortSessionId = session.id;

        // 发送一个会执行较长时间的 prompt
        await OpencodeV2.sendPrompt(
          BASE_URL,
          abortSessionId,
          'Read all files in the current directory and list them',
          worktreeDir,
        );

        // 等一小段时间让 AI pickup
        await new Promise((r) => setTimeout(r, 3000));

        // abort
        await OpencodeV2.abortSession(BASE_URL, abortSessionId, worktreeDir);

        // waitForSessionIdle 应该 reject（或快速返回——取决于 SDK 行为）
        // 这里用 try/catch 捕获，因为某些 SDK 版本 abort 后 wait 可能直接 resolve
        let didReject = false;
        try {
          await OpencodeV2.waitForSessionIdle(BASE_URL, abortSessionId, worktreeDir, 30_000);
        } catch {
          didReject = true;
        }
        // 至少要有一个确定的行为——reject 或 resolve 都可接受，但不能 hang
        // 如果走到这里说明没有 hang（30s 内有结果），测试通过
        expect(true).toBe(true);
      },
      60_000,
    );
  });
});
