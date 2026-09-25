const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) console.warn('[DB] DATABASE_URL is not set. Persistent features are disabled until PostgreSQL is configured.');

const pool = databaseUrl ? new Pool({
  connectionString: databaseUrl,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
}) : null;

async function query(text, params = []) {
  if (!pool) throw new Error('DATABASE_URL is not configured.');
  return pool.query(text, params);
}

async function initDatabase() {
  if (!pool) return;

  await query(`
    CREATE TABLE IF NOT EXISTS afk_status (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT 'AFK',
      set_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS afk_status_guild_idx ON afk_status (guild_id);

    CREATE TABLE IF NOT EXISTS warnings (
      id BIGSERIAL PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL, reason TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS warnings_guild_user_idx ON warnings (guild_id, user_id);

    CREATE TABLE IF NOT EXISTS giveaways (
      id BIGSERIAL PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL UNIQUE, host_id TEXT NOT NULL, prize TEXT NOT NULL,
      winners INTEGER NOT NULL CHECK (winners > 0), ends_at TIMESTAMPTZ NOT NULL,
      ended BOOLEAN NOT NULL DEFAULT FALSE, entries JSONB NOT NULL DEFAULT '[]'::jsonb,
      winner_ids JSONB NOT NULL DEFAULT '[]'::jsonb, required_role_id TEXT,
      excluded_role_id TEXT, min_account_age_days INTEGER NOT NULL DEFAULT 0,
      min_server_age_days INTEGER NOT NULL DEFAULT 0, bonus_entries INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE giveaways ADD COLUMN IF NOT EXISTS required_role_id TEXT;
    ALTER TABLE giveaways ADD COLUMN IF NOT EXISTS excluded_role_id TEXT;
    ALTER TABLE giveaways ADD COLUMN IF NOT EXISTS min_account_age_days INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE giveaways ADD COLUMN IF NOT EXISTS min_server_age_days INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE giveaways ADD COLUMN IF NOT EXISTS bonus_entries INTEGER NOT NULL DEFAULT 0;
    CREATE INDEX IF NOT EXISTS giveaways_active_idx ON giveaways (ended, ends_at);

    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY, log_channel_id TEXT, welcome_channel_id TEXT,
      goodbye_channel_id TEXT, autorole_id TEXT, welcome_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      goodbye_enabled BOOLEAN NOT NULL DEFAULT FALSE, welcome_dm_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      verification_enabled BOOLEAN NOT NULL DEFAULT FALSE, verification_role_id TEXT,
      automod_enabled BOOLEAN NOT NULL DEFAULT FALSE, automod_spam_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      automod_duplicate_enabled BOOLEAN NOT NULL DEFAULT TRUE, automod_mention_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      automod_link_enabled BOOLEAN NOT NULL DEFAULT FALSE, automod_caps_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      automod_emoji_enabled BOOLEAN NOT NULL DEFAULT FALSE, automod_bad_words_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      automod_max_mentions INTEGER NOT NULL DEFAULT 5, automod_max_caps_percent INTEGER NOT NULL DEFAULT 80,
      automod_max_emojis INTEGER NOT NULL DEFAULT 12, automod_spam_window_seconds INTEGER NOT NULL DEFAULT 8,
      automod_spam_message_limit INTEGER NOT NULL DEFAULT 6,
      automod_action TEXT NOT NULL DEFAULT 'warn' CHECK (automod_action IN ('warn', 'timeout', 'delete')),
      level_enabled BOOLEAN NOT NULL DEFAULT FALSE, suggestion_channel_id TEXT,
      ticket_category_id TEXT, ticket_staff_role_id TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS ticket_staff_role_id TEXT;
    CREATE INDEX IF NOT EXISTS guild_settings_updated_idx ON guild_settings (updated_at);

    CREATE TABLE IF NOT EXISTS scheduled_messages (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      content TEXT NOT NULL,
      next_run_at TIMESTAMPTZ NOT NULL,
      repeat_minutes INTEGER NOT NULL DEFAULT 0 CHECK (repeat_minutes >= 0),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS scheduled_messages_due_idx ON scheduled_messages (active, next_run_at);
    CREATE INDEX IF NOT EXISTS scheduled_messages_guild_idx ON scheduled_messages (guild_id, active);

    CREATE TABLE IF NOT EXISTS moderation_cases (
      id BIGSERIAL PRIMARY KEY, guild_id TEXT NOT NULL, target_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL DEFAULT 'No reason provided',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS moderation_cases_guild_target_idx ON moderation_cases (guild_id, target_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS moderation_cases_guild_created_idx ON moderation_cases (guild_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS tickets (
      id BIGSERIAL PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL UNIQUE,
      owner_id TEXT NOT NULL, claimed_by TEXT, status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), closed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS tickets_guild_owner_status_idx ON tickets (guild_id, owner_id, status);
    CREATE INDEX IF NOT EXISTS tickets_guild_status_idx ON tickets (guild_id, status);

    CREATE TABLE IF NOT EXISTS polls (
      id BIGSERIAL PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL UNIQUE, creator_id TEXT NOT NULL, question TEXT NOT NULL,
      options JSONB NOT NULL, anonymous BOOLEAN NOT NULL DEFAULT FALSE,
      multiple BOOLEAN NOT NULL DEFAULT FALSE, ends_at TIMESTAMPTZ,
      closed BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS polls_guild_closed_idx ON polls (guild_id, closed, ends_at);

    CREATE TABLE IF NOT EXISTS poll_votes (
      poll_id BIGINT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL, option_index INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (poll_id, user_id, option_index)
    );
    CREATE INDEX IF NOT EXISTS poll_votes_poll_idx ON poll_votes (poll_id);

    CREATE TABLE IF NOT EXISTS suggestions (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL UNIQUE,
      author_id TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
      staff_response TEXT,
      reviewed_by TEXT,
      reviewed_at TIMESTAMPTZ,
      upvotes INTEGER NOT NULL DEFAULT 0,
      downvotes INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS suggestions_guild_status_idx ON suggestions (guild_id, status, created_at DESC);

    CREATE TABLE IF NOT EXISTS suggestion_votes (
      suggestion_id BIGINT NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      vote INTEGER NOT NULL CHECK (vote IN (-1, 1)),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (suggestion_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS suggestion_votes_suggestion_idx ON suggestion_votes (suggestion_id);

    CREATE TABLE IF NOT EXISTS reputation (\n      guild_id TEXT NOT NULL, user_id TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 0,\n      PRIMARY KEY (guild_id, user_id)\n    );\n\n    CREATE TABLE IF NOT EXISTS reputation_cooldowns (\n      guild_id TEXT NOT NULL, from_user_id TEXT NOT NULL, to_user_id TEXT NOT NULL,\n      last_given_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n      PRIMARY KEY (guild_id, from_user_id, to_user_id)\n    );\n\n    CREATE TABLE IF NOT EXISTS daily_rewards (\n      guild_id TEXT NOT NULL, user_id TEXT NOT NULL, last_claimed_at TIMESTAMPTZ,\n      streak INTEGER NOT NULL DEFAULT 0, total_claims INTEGER NOT NULL DEFAULT 0,\n      PRIMARY KEY (guild_id, user_id)\n    );\n\n    CREATE TABLE IF NOT EXISTS user_levels (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      xp BIGINT NOT NULL DEFAULT 0 CHECK (xp >= 0),
      level INTEGER NOT NULL DEFAULT 0 CHECK (level >= 0),
      message_count BIGINT NOT NULL DEFAULT 0 CHECK (message_count >= 0),
      last_xp_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS user_levels_leaderboard_idx ON user_levels (guild_id, xp DESC);

  `);

  console.log('[DB] Database initialized.');
}

async function closeDatabase() {
  if (pool) await pool.end();
}

module.exports = { pool, query, initDatabase, closeDatabase };
