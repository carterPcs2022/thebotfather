const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.warn('[DB] DATABASE_URL is not set. Persistent features are disabled until PostgreSQL is configured.');
}

const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    })
  : null;

async function query(text, params = []) {
  if (!pool) throw new Error('DATABASE_URL is not configured.');
  return pool.query(text, params);
}

async function initDatabase() {
  if (!pool) return;

  await query(`
    CREATE TABLE IF NOT EXISTS warnings (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS warnings_guild_user_idx
      ON warnings (guild_id, user_id);

    CREATE TABLE IF NOT EXISTS giveaways (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL UNIQUE,
      host_id TEXT NOT NULL,
      prize TEXT NOT NULL,
      winners INTEGER NOT NULL CHECK (winners > 0),
      ends_at TIMESTAMPTZ NOT NULL,
      ended BOOLEAN NOT NULL DEFAULT FALSE,
      entries JSONB NOT NULL DEFAULT '[]'::jsonb,
      winner_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS giveaways_active_idx
      ON giveaways (ended, ends_at);
  `);

  console.log('[DB] Database initialized.');
}

async function closeDatabase() {
  if (pool) await pool.end();
}

module.exports = { pool, query, initDatabase, closeDatabase };
