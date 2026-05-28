import { Prisma } from '@prisma/client';
import prisma from '../../prisma.js';

export async function list() {
  return prisma.project.findMany({
    orderBy: { createdAt: 'desc' },
  });
}

export async function getById(id: string) {
  return prisma.project.findUnique({ where: { id } });
}

export async function create(data: {
  name: string;
  description?: string;
  path?: string;
  readme?: string;
}) {
  return prisma.project.create({
    data: {
      name: data.name,
      description: data.description || '',
      path: data.path || '',
      readme: data.readme,
    },
  });
}

export async function update(
  id: string,
  data: {
    name?: string;
    description?: string;
    path?: string;
    readme?: string;
    status?: string;
  }
) {
  const updateData: Prisma.ProjectUpdateInput = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.path !== undefined) updateData.path = data.path;
  if (data.readme !== undefined) updateData.readme = data.readme;
  if (data.status !== undefined) updateData.status = data.status as any;

  return prisma.project.update({ where: { id }, data: updateData });
}

export async function remove(id: string) {
  return prisma.project.delete({ where: { id } });
}
