import cuid from 'cuid';

/**
 * 生成一批预分配的任务 ID（cuid 格式，与 Prisma @default(cuid()) 一致）。
 *
 * 上游：TaskGraphPage 生成后注入 pageContext，AI 在 <task-plan> 中用这些 ID 作为 ref。
 * 下游：后端 importPlan 校验 ref 格式后直接用作 Task.id，无需 refToId 映射。
 */
export function generateIdPool(count: number = 20): string[] {
  return Array.from({ length: count }, () => cuid());
}
