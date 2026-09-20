const { query } = require('../database/database');

const REP_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

async function giveRep(guildId, fromUserId, toUserId) {
  if (fromUserId === toUserId) throw new Error('SELF_REP');
  const existing = await query('SELECT last_given_at FROM reputation_cooldowns WHERE guild_id=$1 AND from_user_id=$2 AND to_user_id=$3', [guildId, fromUserId, toUserId]);
  if (existing.rows[0]) {
    const elapsed = Date.now() - new Date(existing.rows[0].last_given_at).getTime();
    if (elapsed < REP_COOLDOWN_MS) return { ok: false, remainingMs: REP_COOLDOWN_MS - elapsed };
  }
  await query('INSERT INTO reputation (guild_id,user_id,points) VALUES ($1,$2,1) ON CONFLICT (guild_id,user_id) DO UPDATE SET points=reputation.points+1', [guildId, toUserId]);
  await query('INSERT INTO reputation_cooldowns (guild_id,from_user_id,to_user_id,last_given_at) VALUES ($1,$2,$3,NOW()) ON CONFLICT (guild_id,from_user_id,to_user_id) DO UPDATE SET last_given_at=NOW()', [guildId, fromUserId, toUserId]);
  const row = await query('SELECT points FROM reputation WHERE guild_id=$1 AND user_id=$2', [guildId, toUserId]);
  return { ok: true, points: Number(row.rows[0].points) };
}

async function getRep(guildId, userId) {
  const result = await query('SELECT points FROM reputation WHERE guild_id=$1 AND user_id=$2', [guildId, userId]);
  return Number(result.rows[0]?.points || 0);
}

async function repLeaderboard(guildId, limit=10) {
  const result = await query('SELECT user_id, points FROM reputation WHERE guild_id=$1 ORDER BY points DESC, user_id ASC LIMIT $2', [guildId, limit]);
  return result.rows;
}

async function claimDaily(guildId, userId) {
  const result = await query('SELECT last_claimed_at, streak, total_claims FROM daily_rewards WHERE guild_id=$1 AND user_id=$2', [guildId, userId]);
  const previous = result.rows[0];
  if (previous?.last_claimed_at) {
    const elapsed = Date.now() - new Date(previous.last_claimed_at).getTime();
    if (elapsed < DAILY_COOLDOWN_MS) return { ok: false, remainingMs: DAILY_COOLDOWN_MS - elapsed, streak: Number(previous.streak) };
  }
  const wasRecent = previous?.last_claimed_at && Date.now() - new Date(previous.last_claimed_at).getTime() < DAILY_COOLDOWN_MS * 2;
  const streak = wasRecent ? Number(previous.streak) + 1 : 1;
  const xp = Math.min(200, 50 + (streak - 1) * 10);
  await query('INSERT INTO daily_rewards (guild_id,user_id,last_claimed_at,streak,total_claims) VALUES ($1,$2,NOW(),$3,1) ON CONFLICT (guild_id,user_id) DO UPDATE SET last_claimed_at=NOW(), streak=$3, total_claims=daily_rewards.total_claims+1', [guildId, userId, streak]);
  const levelRow = await query('INSERT INTO user_levels (guild_id,user_id,xp,level,message_count,last_xp_at) VALUES ($1,$2,$3,0,0,NOW()) ON CONFLICT (guild_id,user_id) DO UPDATE SET xp=user_levels.xp+$3, updated_at=NOW(), last_xp_at=NOW() RETURNING *', [guildId, userId, xp]);
  return { ok: true, xp, streak, totalClaims: Number(previous?.total_claims || 0) + 1 };
}

module.exports = { giveRep, getRep, repLeaderboard, claimDaily };