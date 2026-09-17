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

    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      log_channel_id TEXT,
      welcome_channel_id TEXT,
      goodbye_channel_id TEXT,
      autorole_id TEXT,
      welcome_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      goodbye_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      welcome_dm_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      verification_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      verification_role_id TEXT,
      automod_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      automod_spam_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      automod_duplicate_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      automod_mention_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      automod_link_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      automod_caps_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      automod_emoji_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      automod_bad_words_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      automod_max_mentions INTEGER NOT NULL DEFAULT 5,
      automod_max_caps_percent INTEGER NOT NULL DEFAULT 80,
      automod_max_emojis INTEGER NOT NULL DEFAULT 12,
      automod_spam_window_seconds INTEGER NOT NULL DEFAULT 8,
      automod_spam_message_limit INTEGER NOT NULL DEFAULT 6,
      automod_action TEXT NOT NULL DEFAULT 'warn' CHECK (automod_action IN ('warn', 'timeout', 'delete')),
      level_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      suggestion_channel_id TEXT,
      ticket_category_id TEXT,
      ticket_staff_role_id TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE guild_settings
      ADD COLUMN IF NOT EXISTS ticket_staff_role_id TEXT;

    CREATE INDEX IF NOT EXISTS guild_settings_updated_idx
      ON guild_settings (updated_at);

    CREATE TABLE IF NOT EXISTS moderation_cases (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT 'No reason provided',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS moderation_cases_guild_target_idx
      ON moderation_cases (guild_id, target_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS moderation_cases_guild_created_idx
      ON moderation_cases (guild_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS tickets (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL UNIQUE,
      owner_id TEXT NOT NULL,
      claimed_by TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS tickets_guild_owner_status_idx
      ON tickets (guild_id, owner_id, status);

    CREATE INDEX IF NOT EXISTS tickets_guild_status_idx
      ON tickets (guild_id, status);
  `);

  console.log('[DB] Database initialized.');
}

async function closeDatabase() {
  if (pool) await pool.end();
}

module.exports = { pool, query, initDatabase, closeDatabase };
