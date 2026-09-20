const { EmbedBuilder } = require('discord.js');
const { query } = require('../database/database');
const { getSettings } = require('../commands/config');

const cooldowns = new Map();
const COOLDOWN_MS = 60000;
const XP_MIN = 10;
const XP_MAX = 20;

function xpForLevel(level) {
  return 100 * level * level + 100 * level;
}

function levelFromXp(xp) {
  let level = 0;
  while (xp >= xpForLevel(level + 1)) level += 1;
  return level;
}

function xpToNextLevel(level) {
  return xpForLevel(level + 1);
}

function randomXp() {
  return Math.floor(Math.random() * (XP_MAX - XP_MIN + 1)) + XP_MIN;
}

async function awardMessageXp(message) {
  if (!message.guild || message.author.bot) return;
  const settings = await getSettings(message.guild.id);
  if (!settings.level_enabled) return;

  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const last = cooldowns.get(key) || 0;
  if (now - last < COOLDOWN_MS) return;
  cooldowns.set(key, now);

  const gained = randomXp();
  const result = await query(
    `INSERT INTO user_levels (guild_id, user_id, xp, level, message_count, last_xp_at)
     VALUES ($1,$2,$3,0,1,NOW())
     ON CONFLICT (guild_id,user_id)
     DO UPDATE SET xp = user_levels.xp + $3,
                   message_count = user_levels.message_count + 1,
                   last_xp_at = NOW(),
                   updated_at = NOW()
     RETURNING *`,
    [message.guild.id, message.author.id, gained],
  );

  const row = result.rows[0];
  const previousLevel = Number(row.level);
  const newLevel = levelFromXp(Number(row.xp));

  if (newLevel !== previousLevel) {
    await query('UPDATE user_levels SET level = $1, updated_at = NOW() WHERE guild_id = $2 AND user_id = $3', [newLevel, message.guild.id, message.author.id]);
    const embed = new EmbedBuilder()
      .setTitle('🎉 Level Up!')
      .setDescription(`<@${message.author.id}> reached **Level ${newLevel}**!`)
      .addFields({ name: 'XP', value: `${row.xp} / ${xpToNextLevel(newLevel)}` });
    await message.channel.send({ embeds: [embed] }).catch(() => null);
  }
}

async function rank(guildId, userId) {
  const result = await query('SELECT * FROM user_levels WHERE guild_id = $1 AND user_id = $2', [guildId, userId]);
  return result.rows[0] || { guild_id: guildId, user_id: userId, xp: 0, level: 0, message_count: 0 };
}

async function leaderboard(guildId, limit = 10) {
  const result = await query('SELECT * FROM user_levels WHERE guild_id = $1 ORDER BY xp DESC LIMIT $2', [guildId, limit]);
  return result.rows;
}

function startLevelCleanup() {
  setInterval(() => {
    const now = Date.now();
    for (const [key, timestamp] of cooldowns) if (now - timestamp > COOLDOWN_MS * 10) cooldowns.delete(key);
  }, COOLDOWN_MS * 10).unref?.();
}

module.exports = { awardMessageXp, rank, leaderboard, startLevelCleanup, xpForLevel, levelFromXp };
