import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Pool } = pg;

const connectionString = String(process.env.DATABASE_URL || '').trim();
if (!connectionString) {
  throw new Error('DATABASE_URL is missing. Configure backend environment variables.');
}

export const pool = new Pool({
  connectionString,
  ssl: process.env.PG_SSL === 'false' ? false : { rejectUnauthorized: false },
});

export async function withTransaction(handler) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await handler(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
