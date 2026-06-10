import crypto from 'crypto';
import { StepStatus } from '@prisma/client';
import prisma from '../../prisma.js';
import type { ImportStepPlanRequest, ImportStepPlanResponse, ImportedPlanItem } from './types.js';

function computePlanHash(taskName: string, projectId: string, taskId?: string | null): string {
  const canonical = JSON.stringify({ taskName, projectId, taskId: taskId ?? null });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export async function listByProject(projectId: string) {
  const steps = await prisma.step.findMany({
    where: { projectId },
    include: {
      fromDeps: { select: { dependsOnId: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return steps.map((s) => ({
    id: s.id,
    projectId: s.projectId,
    title: s.title,
    description: s.description,
    status: s.status,
    blockedReason: s.blockedReason,
    taskId: s.taskId,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    dependencies: s.fromDeps.map((d) => d.dependsOnId),
  }));
}

export async function listByTask(taskId: string) {
  const steps = await prisma.step.findMany({
    where: { taskId },
    include: {
      fromDeps: { select: { dependsOnId: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return steps.map((s) => ({
    id: s.id,
    projectId: s.projectId,
    title: s.title,
    description: s.description,
    status: s.status,
    blockedReason: s.blockedReason,
    taskId: s.taskId,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    dependencies: s.fromDeps.map((d) => d.dependsOnId),
  }));
}

export async function getById(id: string) {
  const step = await prisma.step.findUnique({
    where: { id },
    include: {
      fromDeps: { select: { dependsOnId: true } },
    },
  });
  if (!step) return null;
  return {
    id: step.id,
    projectId: step.projectId,
    title: step.title,
    description: step.description,
    status: step.status,
    blockedReason: step.blockedReason,
    taskId: step.taskId,
    createdAt: step.createdAt,
    updatedAt: step.updatedAt,
    dependencies: step.fromDeps.map((d) => d.dependsOnId),
  };
}

export async function create(projectId: string, data: { id?: string; title: string; description?: string; taskId?: string }) {
  return prisma.step.create({
    data: {
      ...(data.id ? { id: data.id } : {}),
      projectId,
      title: data.title,
      description: data.description || '',
      taskId: data.taskId || null,
    },
  });
}

export async function update(id: string, data: { title?: string; description?: string; status?: string; blockedReason?: string | null; taskId?: string | null; tokenInput?: number; tokenOutput?: number; cacheRead?: number }) {
  const updateData: Record<string, any> = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.status !== undefined) {
    updateData.status = data.status as StepStatus;
    if (data.status !== 'BLOCKED') updateData.blockedReason = null;
  }
  if (data.blockedReason !== undefined) updateData.blockedReason = data.blockedReason;
  if (data.taskId !== undefined) updateData.taskId = data.taskId;
  if (data.tokenInput !== undefined) updateData.tokenInput = data.tokenInput;
  if (data.tokenOutput !== undefined) updateData.tokenOutput = data.tokenOutput;
  if (data.cacheRead !== undefined) updateData.cacheRead = data.cacheRead;

  return prisma.step.update({
    where: { id },
    data: updateData,
  });
}

export async function remove(id: string) {
  return prisma.step.delete({ where: { id } });
}

const CUID_RE = /^c[a-z0-9]+$/;

export async function importPlan(projectId: string, plan: ImportStepPlanRequest): Promise<ImportStepPlanResponse> {
  for (const item of plan.steps) {
    if (!CUID_RE.test(item.ref)) {
      const err: any = new Error(`Invalid ref format: "${item.ref}". Must be cuid format (e.g. "clxxxx").`);
      err.code = 'INVALID_REF_FORMAT';
      throw err;
    }
  }

  const planHash = computePlanHash(plan.task, projectId, plan.taskId);

  if (plan.chatSessionId) {
    const existing = await prisma.planImport.findUnique({
      where: { chatSessionId_planHash: { chatSessionId: plan.chatSessionId, planHash } },
    });
    if (existing) {
      const err: any = new Error('Plan already imported');
      err.code = 'PLAN_ALREADY_IMPORTED';
      err.existing = { planHash, projectId: existing.projectId, taskId: existing.taskId };
      throw err;
    }
  }

  const stepResults: ImportStepPlanResponse['steps'] = [];

  const result = await prisma.$transaction(async (tx) => {
    let taskId: string | null = plan.taskId ?? null;

    if (!taskId) {
      const task = await tx.task.create({
        data: {
          projectId,
          name: plan.task,
          summary: plan.summary || '',
        },
      });
      taskId = task.id;
    }

    for (const item of plan.steps) {
      const step = await tx.step.create({
        data: {
          id: item.ref,
          projectId,
          taskId,
          title: item.title,
          description: item.description || '',
        },
      });
      stepResults.push({
        id: step.id,
        ref: item.ref,
        title: step.title,
        status: step.status,
      });
    }

    let depCount = 0;
    for (const item of plan.steps) {
      for (const depRef of item.dependencies) {
        await tx.stepDependency.create({
          data: {
            stepId: item.ref,
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
          taskName: plan.task,
          projectId,
          taskId,
        },
      });
    }

    return { taskId: taskId!, imported: stepResults.length, steps: stepResults, dependencies: depCount, planHash };
  });

  return result;
}

export async function getImportedPlans(chatSessionId: string): Promise<ImportedPlanItem[]> {
  const records = await prisma.planImport.findMany({
    where: { chatSessionId },
    select: { planHash: true, taskName: true, projectId: true, taskId: true },
  });
  return records.map((r) => ({ planHash: r.planHash, taskName: r.taskName, projectId: r.projectId, taskId: r.taskId }));
}

export async function addDependency(stepId: string, dependsOnId: string) {
  return prisma.stepDependency.create({
    data: { stepId, dependsOnId },
  });
}

export async function removeDependency(stepId: string, dependsOnId: string) {
  const dep = await prisma.stepDependency.findFirst({
    where: { stepId, dependsOnId },
  });
  if (!dep) throw { code: 'P2025' };
  return prisma.stepDependency.delete({ where: { id: dep.id } });
}
