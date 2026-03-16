import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const migrationsDir = path.resolve(__dirname, '../migrations');
  const files = (await fs.readdir(migrationsDir))
    .filter((name) => /^\d+_.*\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b));

  if (!files.length) {
    throw new Error('No migration files found.');
  }

  for (const file of files) {
    const migrationPath = path.join(migrationsDir, file);
    const sql = await fs.readFile(migrationPath, 'utf8');
    await pool.query(sql);
    console.log(`Migration applied: ${file}`);
  }

  await pool.end();
}

run().catch(async (error) => {
  console.error('Migration failed:', error.message);
  await pool.end();
  process.exit(1);
});
