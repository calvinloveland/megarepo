import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var vernissagePrisma: PrismaClient | undefined;
}

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getPrisma() {
  if (!isDatabaseConfigured()) {
    throw new Error('DATABASE_URL is not configured');
  }

  if (!globalThis.vernissagePrisma) {
    globalThis.vernissagePrisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error']
    });
  }

  return globalThis.vernissagePrisma;
}
