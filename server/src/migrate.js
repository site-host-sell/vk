import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const migrationPath = path.resolve(__dirname, '../migrations/001_init.sql');
  const sql = await fs.readFile(migrationPath, 'utf8');
  await pool.query(sql);
  await pool.end();
  console.log('Migration applied: 001_init.sql');
}

run().catch(async (error) => {
  console.error('Migration failed:', error.message);
  await pool.end();
  process.exit(1);
});
