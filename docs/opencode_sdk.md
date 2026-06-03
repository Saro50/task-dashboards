实施计划：基于消息计数的可靠等待
超时参数
- 单批超时：30 分钟（1800000ms）
- 轮询间隔：3 秒
改动清单
1. packages/server/src/modules/engine/opencode-v2.ts
- 新增 waitForAssistantMessages(baseUrl, sessionId, directory, targetCount, timeoutMs) 方法
- 轮询 getSessionMessages，每 3 秒检查一次 assistant 消息数量
- count >= targetCount 时返回
- 超时 30 分钟抛错
- 每次轮询记录日志（前几次 + 每 10 次一次）
- 移除 waitForSessionIdle 中的 busy-poll 逻辑，恢复为简单的 v2.session.wait 调用（保留作为其他场景的 fallback）
- 更新 EngineAdapter 接口：新增 waitForAssistantMessages 方法签名
2. packages/server/src/modules/engine/engine-mock.ts
- 新增 waitForAssistantMessages mock 实现
- 等 taskDelay（模拟处理时间）
- 调用 generateResponses 产生 assistant 消息
- 验证 assistant 数量达标
3. packages/server/src/modules/execution/execution.service.ts
第二阶段改为：
// 记录 baseline（发送前的 assistant 数量）
const preMessages = await getSessionMessages(...)
const baseline = preMessages.filter(role=assistant).length

// 第一阶段：发送所有 prompt（不变）
for (const task of toStart) { sendPrompt(...) }

// 第二阶段：等 assistant 消息增长到 baseline + batchSize
await waitForAssistantMessages(baseUrl, sessionId, directory, baseline + toStart.length)

// 第三阶段：验证 + 标记完成（简化，不再需要重新 getMessage）
- 移除 executeTasks 中发送前后的固定延迟（setTimeout(100)）
- 简化第三阶段的验证逻辑：waitForAssistantMessages 已保证数量，但仍做一次 getSessionMessages 确认，用于区分 COMPLETED / BLOCKED
4. 测试
- 现有 21 个测试应全部通过
- 不新增测试（mock 的 waitForAssistantMessages 行为与原 waitForSessionIdle 一致）
代码变更细节
opencode-v2.ts 新增方法：
async waitForAssistantMessages(baseUrl, sessionId, directory, targetCount, timeoutMs = 1800000) {
  const POLL_INTERVAL = 3000;
  const client = await getClient(baseUrl);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const result = await client.session.messages({ sessionID: sessionId, directory });
    const messages = (result.data as any[]) ?? [];
    const count = messages.filter((m: any) => m.role === 'assistant').length;
    if (count >= targetCount) {
      logger.info(S, 'waitForAssistantMessages — target reached', { sessionId, count, targetCount, elapsedMs: Date.now() - start });
      return;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  throw new Error(`Timed out waiting for ${targetCount} assistant messages after ${timeoutMs}ms`);
}
execution.service.ts executeTasks 第二阶段改为：
// 记录发送前的 assistant 消息数量
let baseline = 0;
try {
  const preMessages = await OpencodeV2.getSessionMessages(baseUrl, sessionId, directory);
  baseline = preMessages.filter((m: any) => m.role === 'assistant').length;
} catch {}
logger.info(S, 'baseline assistant count', { executionId, baseline });

// 第一阶段：逐个发送 prompt（不变）
for (const task of toStart) { ... }

// 第二阶段：等待 assistant 消息增长到 baseline + batchSize
logger.info(S, 'waiting for assistant messages', { executionId, target: baseline + toStart.length, batch: toStart.length });

try {
  await OpencodeV2.waitForAssistantMessages(baseUrl, sessionId, directory, baseline + toStart.length);
} catch (err: any) {
  // 超时处理逻辑（同原来的 waitForSessionIdle error 分支）
}
engine-mock.ts 新增方法：
async waitForAssistantMessages(_baseUrl, sessionId, _directory, _targetCount, _timeoutMs) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Mock session not found: ${sessionId}`);
  if (session.aborted) throw new Error('Session already aborted');

  // 等 taskDelay 模拟处理时间，然后生成响应
  // （逻辑与原 waitForSessionIdle 相同，只是方法名变了）
  let abortCb: (() => void) | null = null;
  await new Promise<void>((resolve, reject) => { ... });
  if (session.aborted) throw new Error('Session aborted');
  this.generateResponses(session);
}
不改动的文件
- waitForSessionIdle 保留原样（可能其他地方用到）
- 第三阶段的 getSessionMessages 检查保留（用于区分 COMPLETED vs BLOCKED）
- 前端代码无改动
风险
- getSessionMessages API 的频率：3 秒一次轮询，30 分钟最多 600 次调用。对 opencode engine 来说负担很小。
- 如果 opencode engine 的 session.messages API 本身有延迟，可能导致 baseline 记录时包含了上一批的 assistant 消息。但由于我们是在发送前记录 baseline，这正好是正确的值。