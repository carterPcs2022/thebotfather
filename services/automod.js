const { PermissionFlagsBits } = require('discord.js');
const { query } = require('../database/database');
const { normalizeSettings } = require('../utils/config');

const messageHistory = new Map();
const duplicateHistory = new Map();
const cooldowns = new Map();

const INVITE_RE = /(discord(?:\.gg|(?:app)?\.com\/invite)\/[^\s]+)/i;
const URL_RE = /https?:\/\/[^\s]+/i;
const EMOJI_RE = /(?:\p{Extended_Pictographic}|<a?:\w+:\d+>)/gu;
const BAD_WORDS = (process.env.AUTOMOD_BAD_WORDS || '').split(',').map(word => word.trim().toLowerCase()).filter(Boolean);

async function getSettings(guildId) {
  const result = await query('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId]);
  return normalizeSettings(result.rows[0]);
}

function getCapsPercent(content) {
  const letters = content.match(/[A-Za-z]/g) || [];
  if (!letters.length) return 0;
  const uppercase = letters.filter(char => char === char.toUpperCase()).length;
  return Math.round((uppercase / letters.length) * 100);
}

function isExempt(message) {
  if (!message.guild || !message.member) return true;
  if (message.author.bot) return true;
  return message.member.permissions.has(PermissionFlagsBits.Administrator);
}

function remember(map, key, value, maxAgeMs) {
  const now = Date.now();
  const existing = (map.get(key) || []).filter(item => now - item.time <= maxAgeMs);
  existing.push(value);
  map.set(key, existing);
  return existing;
}

async function createCase(guildId, targetId, moderatorId, action, reason, metadata = {}) {
  await query(
    `INSERT INTO moderation_cases (guild_id, target_id, moderator_id, action, reason, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [guildId, targetId, moderatorId, action, reason, JSON.stringify(metadata)],
  );
}

async function applyAction(message, reason, settings) {
  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const last = cooldowns.get(key) || 0;
  if (now - last < 3000) return;
  cooldowns.set(key, now);

  const deleted = await message.delete().then(() => true).catch(() => false);

  if (settings.automod_action === 'timeout' && message.member?.moderatable) {
    await message.member.timeout(60_000, `AutoMod: ${reason}`).catch(() => null);
    await createCase(message.guild.id, message.author.id, message.client.user.id, 'automod-timeout', reason, { deleted });
  } else if (settings.automod_action === 'warn') {
    await query(
      `INSERT INTO warnings (guild_id, user_id, moderator_id, reason)
       VALUES ($1, $2, $3, $4)`,
      [message.guild.id, message.author.id, message.client.user.id, `AutoMod: ${reason}`],
    );
    await createCase(message.guild.id, message.author.id, message.client.user.id, 'automod-warn', reason, { deleted });
  } else {
    await createCase(message.guild.id, message.author.id, message.client.user.id, 'automod-delete', reason, { deleted });
  }

  const channel = settings.log_channel_id ? message.guild.channels.cache.get(settings.log_channel_id) : null;
  if (channel?.isTextBased()) {
    await channel.send({
      content: `🛡️ **AutoMod** action **${settings.automod_action}** for **${message.author.tag}** in ${message.channel}. Reason: ${reason}`,
    }).catch(() => null);
  }
}

async function handleMessage(message) {
  if (isExempt(message)) return;
  let settings;
  try {
    settings = await getSettings(message.guild.id);
  } catch (error) {
    console.error('[AutoMod] Could not load settings:', error.message);
    return;
  }
  if (!settings.automod_enabled) return;

  const content = message.content || '';
  const normalized = content.trim().toLowerCase().replace(/\s+/g, ' ');
  const key = `${message.guild.id}:${message.author.id}`;
  const windowMs = settings.automod_spam_window_seconds * 1000;

  if (settings.automod_spam_enabled) {
    const recent = remember(messageHistory, key, { time: Date.now(), channelId: message.channel.id }, windowMs);
    if (recent.length >= settings.automod_spam_message_limit) {
      messageHistory.delete(key);
      return applyAction(message, 'message flooding / spam', settings);
    }
  }

  if (settings.automod_duplicate_enabled && normalized.length >= 3) {
    const recent = remember(duplicateHistory, key, { time: Date.now(), content: normalized }, windowMs);
    const duplicateCount = recent.filter(item => item.content === normalized).length;
    if (duplicateCount >= 3) {
      duplicateHistory.delete(key);
      return applyAction(message, 'repeated duplicate messages', settings);
    }
  }

  if (settings.automod_bad_words_enabled) {
    const words = new Set(content.toLowerCase().replace(/[^a-z0-9]+/gi, ' ').split(/\s+/).filter(Boolean));
    if (BAD_WORDS.some(word => words.has(word))) return applyAction(message, 'blocked word filter', settings);
  }

  if (settings.automod_mention_enabled && message.mentions.users.size + message.mentions.roles.size > settings.automod_max_mentions) {
    return applyAction(message, `too many mentions (${message.mentions.users.size + message.mentions.roles.size})`, settings);
  }

  if (settings.automod_link_enabled && (URL_RE.test(content) || INVITE_RE.test(content))) {
    return applyAction(message, 'links or Discord invites are not allowed', settings);
  }

  if (settings.automod_caps_enabled && content.length >= 12 && getCapsPercent(content) >= settings.automod_max_caps_percent) {
    return applyAction(message, 'excessive capital letters', settings);
  }

  if (settings.automod_emoji_enabled && (content.match(EMOJI_RE) || []).length > settings.automod_max_emojis) {
    return applyAction(message, 'excessive emoji', settings);
  }
}

function clearGuild(guildId) {
  for (const map of [messageHistory, duplicateHistory]) {
    for (const key of map.keys()) if (key.startsWith(`${guildId}:`)) map.delete(key);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entries] of messageHistory) {
    const filtered = entries.filter(item => now - item.time < 60_000);
    if (filtered.length) messageHistory.set(key, filtered); else messageHistory.delete(key);
  }
  for (const [key, entries] of duplicateHistory) {
    const filtered = entries.filter(item => now - item.time < 60_000);
    if (filtered.length) duplicateHistory.set(key, filtered); else duplicateHistory.delete(key);
  }
  for (const [key, timestamp] of cooldowns) {
    if (now - timestamp > 60_000) cooldowns.delete(key);
  }
}, 60_000).unref();

module.exports = { handleMessage, clearGuild };
