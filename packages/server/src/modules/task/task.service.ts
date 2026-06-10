import prisma from '../../prisma.js';
import type { TaskWithStats, TaskDependency } from './types.js';

export async function listByProject(projectId: string): Promise<TaskWithStats[]> {
  const tasks = await prisma.task.findMany({
    where: { projectId },
    include: {
      steps: {
        select: { status: true, tokenInput: true, tokenOutput: true, cacheRead: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return tasks.map((task) => {
    const stepCount = task.steps.length;
    const completedStepCount = task.steps.filter((s) => s.status === 'COMPLETED').length;
    const hasBlocked = task.steps.some((s) => s.status === 'BLOCKED');
    const hasInProgress = task.steps.some((s) => s.status === 'IN_PROGRESS');
    let aggregatedStatus: TaskWithStats['aggregatedStatus'] = 'PENDING';
    if (stepCount > 0 && completedStepCount === stepCount) {
      aggregatedStatus = 'COMPLETED';
    } else if (hasBlocked) {
      aggregatedStatus = 'BLOCKED';
    } else if (hasInProgress) {
      aggregatedStatus = 'IN_PROGRESS';
    }

    const tokenInput = task.steps.reduce((sum, s) => sum + (s.tokenInput || 0), 0);
    const tokenOutput = task.steps.reduce((sum, s) => sum + (s.tokenOutput || 0), 0);
    const cacheRead = task.steps.reduce((sum, s) => sum + (s.cacheRead || 0), 0);

    return {
      id: task.id,
      projectId: task.projectId,
      name: task.name,
      summary: task.summary,
      stepCount,
      completedStepCount,
      aggregatedStatus,
      tokenInput,
      tokenOutput,
      cacheRead,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    };
  });
}

export async function getById(id: string) {
  return prisma.task.findUnique({ where: { id } });
}

export async function create(projectId: string, data: { name: string; summary?: string }) {
  return prisma.task.create({
    data: {
      projectId,
      name: data.name,
      summary: data.summary || '',
    },
  });
}

export async function update(id: string, data: { name?: string; summary?: string }) {
  const updateData: Record<string, any> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.summary !== undefined) updateData.summary = data.summary;
  return prisma.task.update({ where: { id }, data: updateData });
}

export async function remove(id: string) {
  return prisma.task.delete({ where: { id } });
}

export async function deriveDependencies(projectId: string): Promise<TaskDependency[]> {
  const deps = await prisma.stepDependency.findMany({
    where: {
      step: { projectId },
      dependsOn: { projectId },
    },
    select: {
      stepId: true,
      dependsOnId: true,
    },
  });

  const steps = await prisma.step.findMany({
    where: { projectId, taskId: { not: null } },
    select: { id: true, taskId: true },
  });

  const stepToTask = new Map<string, string>();
  for (const s of steps) {
    stepToTask.set(s.id, s.taskId!);
  }

  const seen = new Set<string>();
  const result: TaskDependency[] = [];

  for (const dep of deps) {
    const sourceTaskId = stepToTask.get(dep.dependsOnId);
    const targetTaskId = stepToTask.get(dep.stepId);
    if (!sourceTaskId || !targetTaskId || sourceTaskId === targetTaskId) continue;

    const key = `${sourceTaskId}->${targetTaskId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ sourceId: sourceTaskId, targetId: targetTaskId });
  }

  return result;
}

export async function getOrphanSteps(projectId: string) {
  const steps = await prisma.step.findMany({
    where: { projectId, taskId: null },
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
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    dependencies: s.fromDeps.map((d) => d.dependsOnId),
    taskId: null,
  }));
}
