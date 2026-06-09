import cuid from 'cuid';
import type { Context } from 'koa';

/**
 * ID 池接口 — 为 AI agent 生成一批预分配的 cuid 格式 ID。
 *
 * 上下游影响：
 * - 上游：AI agent 通过 webfetch 调用此接口，获取可用 ID 用于 <task-plan> 中的 ref。
 * - 下游：后端 importPlan 校验 ref 必须为 cuid 格式（与 Prisma @default(cuid()) 一致），
 *   这些 ID 可直接用作 Task.id。
 *
 * 该接口无需鉴权，仅返回随机 ID，不涉及敏感操作。
 */

const MAX_COUNT = 100;
const DEFAULT_COUNT = 20;

export async function generate(ctx: Context) {
  const raw = Number(ctx.query.count) || DEFAULT_COUNT;
  const count = Math.min(Math.max(Math.floor(raw), 1), MAX_COUNT);
  const ids = Array.from({ length: count }, () => cuid());
  ctx.body = { data: ids };
}
