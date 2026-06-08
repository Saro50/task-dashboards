import prisma from '../../prisma.js';
import type { TopicWithStats, TopicDependency } from './types.js';

export async function listByProject(projectId: string): Promise<TopicWithStats[]> {
  const topics = await prisma.taskTopic.findMany({
    where: { projectId },
    include: {
      tasks: {
        select: { status: true, tokenInput: true, tokenOutput: true, cacheRead: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return topics.map((topic) => {
    const taskCount = topic.tasks.length;
    const completedCount = topic.tasks.filter((t) => t.status === 'COMPLETED').length;
    const hasBlocked = topic.tasks.some((t) => t.status === 'BLOCKED');
    const hasInProgress = topic.tasks.some((t) => t.status === 'IN_PROGRESS');
    let aggregatedStatus: TopicWithStats['aggregatedStatus'] = 'PENDING';
    if (taskCount > 0 && completedCount === taskCount) {
      aggregatedStatus = 'COMPLETED';
    } else if (hasBlocked) {
      aggregatedStatus = 'BLOCKED';
    } else if (hasInProgress) {
      aggregatedStatus = 'IN_PROGRESS';
    }

    // ── 从 tasks 中累加 token 消耗 ──
    const tokenInput = topic.tasks.reduce((sum, t) => sum + (t.tokenInput || 0), 0);
    const tokenOutput = topic.tasks.reduce((sum, t) => sum + (t.tokenOutput || 0), 0);
    const cacheRead = topic.tasks.reduce((sum, t) => sum + (t.cacheRead || 0), 0);

    return {
      id: topic.id,
      projectId: topic.projectId,
      name: topic.name,
      summary: topic.summary,
      taskCount,
      completedCount,
      aggregatedStatus,
      tokenInput,
      tokenOutput,
      cacheRead,
      createdAt: topic.createdAt.toISOString(),
      updatedAt: topic.updatedAt.toISOString(),
    };
  });
}

export async function getById(id: string) {
  return prisma.taskTopic.findUnique({ where: { id } });
}

export async function create(projectId: string, data: { name: string; summary?: string }) {
  return prisma.taskTopic.create({
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
  return prisma.taskTopic.update({ where: { id }, data: updateData });
}

export async function remove(id: string) {
  return prisma.taskTopic.delete({ where: { id } });
}

export async function deriveDependencies(projectId: string): Promise<TopicDependency[]> {
  const deps = await prisma.taskDependency.findMany({
    where: {
      task: { projectId },
      dependsOn: { projectId },
    },
    select: {
      taskId: true,
      dependsOnId: true,
    },
  });

  const tasks = await prisma.task.findMany({
    where: { projectId, topicId: { not: null } },
    select: { id: true, topicId: true },
  });

  const taskToTopic = new Map<string, string>();
  for (const t of tasks) {
    taskToTopic.set(t.id, t.topicId!);
  }

  const seen = new Set<string>();
  const result: TopicDependency[] = [];

  for (const dep of deps) {
    const sourceTopicId = taskToTopic.get(dep.dependsOnId);
    const targetTopicId = taskToTopic.get(dep.taskId);
    if (!sourceTopicId || !targetTopicId || sourceTopicId === targetTopicId) continue;

    const key = `${sourceTopicId}->${targetTopicId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ sourceId: sourceTopicId, targetId: targetTopicId });
  }

  return result;
}

export async function getOrphanTasks(projectId: string) {
  const tasks = await prisma.task.findMany({
    where: { projectId, topicId: null },
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
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    dependencies: t.fromDeps.map((d) => d.dependsOnId),
    topicId: null,
  }));
}
