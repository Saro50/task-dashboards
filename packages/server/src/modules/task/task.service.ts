import { TaskStatus } from '@prisma/client';
import prisma from '../../prisma.js';
import type { ImportTaskPlanRequest, ImportTaskPlanResponse } from './types.js';

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
    topicId: task.topicId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    dependencies: task.fromDeps.map((d) => d.dependsOnId),
  };
}

export async function create(projectId: string, data: { title: string; description?: string; topicId?: string }) {
  return prisma.task.create({
    data: {
      projectId,
      title: data.title,
      description: data.description || '',
      topicId: data.topicId || null,
    },
  });
}

export async function update(id: string, data: { title?: string; description?: string; status?: string; topicId?: string | null }) {
  const updateData: Record<string, any> = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.status !== undefined) updateData.status = data.status as TaskStatus;
  if (data.topicId !== undefined) updateData.topicId = data.topicId;

  return prisma.task.update({
    where: { id },
    data: updateData,
  });
}

export async function remove(id: string) {
  return prisma.task.delete({ where: { id } });
}

export async function importPlan(projectId: string, plan: ImportTaskPlanRequest): Promise<ImportTaskPlanResponse> {
  const refToId = new Map<string, string>();
  const taskResults: ImportTaskPlanResponse['tasks'] = [];

  const result = await prisma.$transaction(async (tx) => {
    const topic = await tx.taskTopic.create({
      data: {
        projectId,
        name: plan.topic,
        summary: plan.summary || '',
      },
    });

    for (const item of plan.tasks) {
      const task = await tx.task.create({
        data: {
          projectId,
          topicId: topic.id,
          title: item.title,
          description: item.description || '',
        },
      });
      refToId.set(item.ref, task.id);
      taskResults.push({
        id: task.id,
        ref: item.ref,
        title: task.title,
        status: task.status,
      });
    }

    let depCount = 0;
    for (const item of plan.tasks) {
      for (const depRef of item.dependencies) {
        const dependsOnId = refToId.get(depRef);
        if (!dependsOnId) continue;
        await tx.taskDependency.create({
          data: {
            taskId: refToId.get(item.ref)!,
            dependsOnId,
          },
        });
        depCount++;
      }
    }

    return { topicId: topic.id, imported: taskResults.length, tasks: taskResults, dependencies: depCount };
  });

  return result;
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
