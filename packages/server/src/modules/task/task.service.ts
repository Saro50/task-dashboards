import crypto from 'crypto';
import { TaskStatus } from '@prisma/client';
import prisma from '../../prisma.js';
import type { ImportTaskPlanRequest, ImportTaskPlanResponse, ImportedPlanItem } from './types.js';

/**
 * 计算 plan 的去重哈希。
 * 基于 topicName + projectId + topicId，不包含任务内容。
 * 这样同一主题在同一会话中只能导入一次，AI 修改任务后重新生成的 plan
 * 只要 topicName 相同就会命中去重，前端据此进入 diff 更新模式。
 */
function computePlanHash(topicName: string, projectId: string, topicId?: string | null): string {
  const canonical = JSON.stringify({ topicName, projectId, topicId: topicId ?? null });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export async function listByProject(projectId: string) {
  const tasks = await prisma.task.findMany({
    where: { projectId },
    include: {
      fromDeps: { select: { dependsOnId: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return tasks.map((t) => ({
    id: t.id,
    projectId: t.projectId,
    title: t.title,
    description: t.description,
    status: t.status,
    blockedReason: t.blockedReason,
    topicId: t.topicId,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    dependencies: t.fromDeps.map((d) => d.dependsOnId),
  }));
}

export async function listByTopic(topicId: string) {
  const tasks = await prisma.task.findMany({
    where: { topicId },
    include: {
      fromDeps: { select: { dependsOnId: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return tasks.map((t) => ({
    id: t.id,
    projectId: t.projectId,
    title: t.title,
    description: t.description,
    status: t.status,
    blockedReason: t.blockedReason,
    topicId: t.topicId,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    dependencies: t.fromDeps.map((d) => d.dependsOnId),
  }));
}

export async function getById(id: string) {
  const task = await prisma.task.findUnique({
    where: { id },
    include: {
      fromDeps: { select: { dependsOnId: true } },
    },
  });
  if (!task) return null;
  return {
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    description: task.description,
    status: task.status,
    blockedReason: task.blockedReason,
    topicId: task.topicId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    dependencies: task.fromDeps.map((d) => d.dependsOnId),
  };
}

export async function create(projectId: string, data: { id?: string; title: string; description?: string; topicId?: string }) {
  return prisma.task.create({
    data: {
      ...(data.id ? { id: data.id } : {}),
      projectId,
      title: data.title,
      description: data.description || '',
      topicId: data.topicId || null,
    },
  });
}

export async function update(id: string, data: { title?: string; description?: string; status?: string; blockedReason?: string | null; topicId?: string | null; tokenInput?: number; tokenOutput?: number; cacheRead?: number }) {
  const updateData: Record<string, any> = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.status !== undefined) {
    updateData.status = data.status as TaskStatus;
    if (data.status !== 'BLOCKED') updateData.blockedReason = null;
  }
  if (data.blockedReason !== undefined) updateData.blockedReason = data.blockedReason;
  if (data.topicId !== undefined) updateData.topicId = data.topicId;
  /** Token 消耗字段：执行完成时累加 */
  if (data.tokenInput !== undefined) updateData.tokenInput = data.tokenInput;
  if (data.tokenOutput !== undefined) updateData.tokenOutput = data.tokenOutput;
  if (data.cacheRead !== undefined) updateData.cacheRead = data.cacheRead;

  return prisma.task.update({
    where: { id },
    data: updateData,
  });
}

export async function remove(id: string) {
  return prisma.task.delete({ where: { id } });
}

/** cuid 格式校验：以 c 开头 + 小写字母数字，与 Prisma @default(cuid()) 一致 */
const CUID_RE = /^c[a-z0-9]+$/;

export async function importPlan(projectId: string, plan: ImportTaskPlanRequest): Promise<ImportTaskPlanResponse> {
  /** 校验所有 ref 必须为 cuid 格式 */
  for (const item of plan.tasks) {
    if (!CUID_RE.test(item.ref)) {
      const err: any = new Error(`Invalid ref format: "${item.ref}". Must be cuid format (e.g. "clxxxx").`);
      err.code = 'INVALID_REF_FORMAT';
      throw err;
    }
  }

  const planHash = computePlanHash(plan.topic, projectId, plan.topicId);

  if (plan.chatSessionId) {
    const existing = await prisma.planImport.findUnique({
      where: { chatSessionId_planHash: { chatSessionId: plan.chatSessionId, planHash } },
    });
    if (existing) {
      const err: any = new Error('Plan already imported');
      err.code = 'PLAN_ALREADY_IMPORTED';
      err.existing = { planHash, projectId: existing.projectId, topicId: existing.topicId };
      throw err;
    }
  }

  const taskResults: ImportTaskPlanResponse['tasks'] = [];

  const result = await prisma.$transaction(async (tx) => {
    let topicId: string | null = plan.topicId ?? null;

    if (!topicId) {
      const topic = await tx.taskTopic.create({
        data: {
          projectId,
          name: plan.topic,
          summary: plan.summary || '',
        },
      });
      topicId = topic.id;
    }

    /** ref 就是真实 ID，直接用作 Task.id */
    for (const item of plan.tasks) {
      const task = await tx.task.create({
        data: {
          id: item.ref,
          projectId,
          topicId,
          title: item.title,
          description: item.description || '',
        },
      });
      taskResults.push({
        id: task.id,
        ref: item.ref,
        title: task.title,
        status: task.status,
      });
    }

    /** 依赖创建：ref 直接就是目标任务的 ID */
    let depCount = 0;
    for (const item of plan.tasks) {
      for (const depRef of item.dependencies) {
        await tx.taskDependency.create({
          data: {
            taskId: item.ref,
            dependsOnId: depRef,
          },
        });
        depCount++;
      }
    }

    if (plan.chatSessionId) {
      await tx.planImport.create({
        data: {
          chatSessionId: plan.chatSessionId,
          planHash,
          topicName: plan.topic,
          projectId,
          topicId,
        },
      });
    }

    return { topicId: topicId!, imported: taskResults.length, tasks: taskResults, dependencies: depCount, planHash };
  });

  return result;
}

export async function getImportedPlans(chatSessionId: string): Promise<ImportedPlanItem[]> {
  const records = await prisma.planImport.findMany({
    where: { chatSessionId },
    select: { planHash: true, topicName: true, projectId: true, topicId: true },
  });
  return records.map((r) => ({ planHash: r.planHash, topicName: r.topicName, projectId: r.projectId, topicId: r.topicId }));
}

export async function addDependency(taskId: string, dependsOnId: string) {
  return prisma.taskDependency.create({
    data: { taskId, dependsOnId },
  });
}

export async function removeDependency(taskId: string, dependsOnId: string) {
  const dep = await prisma.taskDependency.findFirst({
    where: { taskId, dependsOnId },
  });
  if (!dep) throw { code: 'P2025' };
  return prisma.taskDependency.delete({ where: { id: dep.id } });
}
