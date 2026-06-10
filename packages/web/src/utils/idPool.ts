import cuid from 'cuid';

/**
 * 生成一批预分配的步骤 ID（cuid 格式，与 Prisma @default(cuid()) 一致）。
 *
 * 上游：StepGraphPage 生成后注入 pageContext，AI 在 <step-plan> 中用这些 ID 作为 ref。
 * 下游：后端 importPlan 校验 ref 格式后直接用作 Step.id，无需 refToId 映射。
 */
export function generateIdPool(count: number = 20): string[] {
  return Array.from({ length: count }, () => cuid());
}
