import { PrismaClient } from '@/app/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

function createPrismaClient() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL!,
    ssl: { rejectUnauthorized: false },
  });
  const adapter = new PrismaPg(pool);
  // Interactive transactions get room for a slow link to the database: with the
  // defaults (5 s to run, 2 s to start) a single slow round trip expired a
  // transaction mid-save - a report draft silently not made.
  return new PrismaClient({ adapter, transactionOptions: { maxWait: 10_000, timeout: 20_000 } } as any);
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
