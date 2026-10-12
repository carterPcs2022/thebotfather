require('dotenv').config();

const { createClient } = require('@libsql/client');

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error('[Turso POC] Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in your local environment.');
  process.exit(1);
}

const client = createClient({ url, authToken });
const tableName = 'tbf_turso_poc_smoke_test';

async function main() {
  try {
    await client.execute(`CREATE TABLE IF NOT EXISTS ${tableName} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      feature TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE (guild_id, feature)
    )`);

    await client.execute({
      sql: `INSERT INTO ${tableName} (guild_id, feature, enabled, metadata_json)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(guild_id, feature) DO UPDATE SET
              enabled = excluded.enabled,
              metadata_json = excluded.metadata_json`,
      args: ['poc-guild', 'automod', 1, JSON.stringify({ action: 'warn', maxMentions: 5 })],
    });

    const result = await client.execute({
      sql: `SELECT id, guild_id, feature, enabled, metadata_json, created_at
            FROM ${tableName} WHERE guild_id = ? AND feature = ?`,
      args: ['poc-guild', 'automod'],
    });

    const row = result.rows[0];
    if (!row || row.enabled !== 1 || JSON.parse(row.metadata_json).action !== 'warn') {
      throw new Error('Smoke test returned unexpected data.');
    }

    console.log('[Turso POC] PASS: create, upsert, read, boolean-like integer, JSON text, timestamp.');
    console.log('[Turso POC] Test row:', JSON.stringify(row));
  } finally {
    await client.execute(`DROP TABLE IF EXISTS ${tableName}`).catch(() => null);
    client.close();
  }
}

main().catch(error => {
  console.error('[Turso POC] FAIL:', error.message);
  process.exitCode = 1;
});
