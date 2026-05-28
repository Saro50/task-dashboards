import prisma from '../../prisma';
import type { EngineConfigUpsertInput } from './types';

export async function get() {
  return prisma.engineConfig.findUnique({ where: { id: 'default' } });
}

export async function upsert(data: EngineConfigUpsertInput) {
  return prisma.engineConfig.upsert({
    where: { id: 'default' },
    update: { baseUrl: data.baseUrl },
    create: { id: 'default', baseUrl: data.baseUrl },
  });
}

export async function remove() {
  return prisma.engineConfig.delete({ where: { id: 'default' } });
}

export async function getBaseUrl() {
  const config = await get();
  return config?.baseUrl || process.env.OPENCODE_BASE_URL || 'http://localhost:4096';
}
