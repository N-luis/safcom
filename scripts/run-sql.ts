/**
 * Runs a checked-in SQL setup file against DATABASE_URL.
 *
 *   npx tsx --env-file=.env scripts/run-sql.ts prisma/sql/<file>.sql
 *
 * Only for the static, reviewed files under prisma/sql - never for anything
 * built from input. Statements are split on semicolons at the end of a line.
 */
import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma';

async function main() {
  const file = process.argv[2];
  if (!file || !file.replace(/\\/g, '/').includes('prisma/sql/') || !file.endsWith('.sql')) {
    throw new Error('Pass a .sql file under prisma/sql/');
  }
  const sql = fs.readFileSync(path.resolve(file), 'utf8')
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  const statements = sql.split(/;\s*(?:\r?\n|$)/).map(s => s.trim()).filter(Boolean);
  for (const st of statements) {
    await prisma.$executeRawUnsafe(st);
    console.log('ok  ', st.split('\n')[0].slice(0, 90));
  }
  console.log(`\n${statements.length} statements applied from ${file}`);
}

main()
  .catch(err => { console.error('FAILED:', err instanceof Error ? err.message : err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
