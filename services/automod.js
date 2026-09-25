const { PermissionFlagsBits } = require('discord.js');
const { query } = require('../database/database');
const { normalizeSettings } = require('../utils/config');

const messageHistory = new Map();
const duplicateHistory = new Map();
const cooldowns = new Map();
const settingsCache = new Map();
const SETTINGS_CACHE_MS = 15_000;

const INVITE_RE = /(discord(?:\.gg|(?:app)?\.com\/invite)\/[^\s]+)/i;
const URL_RE = /https?:\/\/[^\s]+/i;
const EMOJI_RE = /(?:\p{Extended_Pictographic}|<a?:\w+:\d+>)/gu;
const BAD_WORDS = (process.env.AUTOMOD_BAD_WORDS || '').split(',').map(word => word.trim().toLowerCase()).filter(Boolean);

async function getSettings(guildId) {
  const cached = settingsCache.get(guildId);
  if (cached && Date.now() - cached.time < SETTINGS_CACHE_MS) return cached.settings;
  const result = await query('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId]);
  const settings = normalizeSettings(result.rows[0]);
  settingsCache.set(guildId, { time: Date.now(), settings });
  return settings;
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

function createCase(guildId, targetId, moderatorId, action, reason, metadata = {}) {
  void query(
    `INSERT INTO moderation_cases (guild_id, target_id, moderator_id, action, reason, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [guildId, targetId, moderatorId, action, reason, JSON.stringify(metadata)],
  ).catch(error => console.error('[AutoMod] Case record failed:', error.message));
}

async function applyAction(message, reason, settings) {
  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const last = cooldowns.get(key) || 0;
  if (now - last < 3000) return;
  cooldowns.set(key, now);

  const deleted = await message.delete().then(() => true).catch(() => false);

  if (settings.automod_action === 'timeout') {
    const timedOut = message.member?.moderatable
      ? await message.member.timeout(60_000, `AutoMod: ${reason}`).then(() => true).catch(() => false)
      : false;
    if (timedOut) {
      createCase(message.guild.id, message.author.id, message.client.user.id, 'automod-timeout', reason, { deleted, duration_seconds: 60 });
    } else {
      createCase(message.guild.id, message.author.id, message.client.user.id, 'automod-delete', reason, {
        deleted,
        requested_action: 'timeout',
        timeout_failed: true,
      });
    }
  } else if (settings.automod_action === 'warn') {
    const warningResult = await query(
      `INSERT INTO warnings (guild_id, user_id, moderator_id, reason)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [message.guild.id, message.author.id, message.client.user.id, `AutoMod: ${reason}`],
    );
    createCase(message.guild.id, message.author.id, message.client.user.id, 'automod-warn', reason, {
      deleted,
      warning_id: warningResult.rows[0]?.id || null,
    });
  } else {
    createCase(message.guild.id, message.author.id, message.client.user.id, 'automod-delete', reason, { deleted });
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
  const normalized = content.trim().toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const key = `${message.guild.id}:${message.author.id}`;
  const windowMs = settings.automod_spam_window_seconds * 1000;

  if (settings.automod_spam_enabled) {
    const recent = remember(messageHistory, key, { time: Date.now(), channelId: message.channel.id }, windowMs);
    const burstCount = recent.filter(item => item.channelId === message.channel.id).length;
    if (burstCount >= settings.automod_spam_message_limit) {
      messageHistory.delete(key);
      return applyAction(message, `message flooding / spam (${burstCount} messages in ${settings.automod_spam_window_seconds}s)`, settings);
    }
  }

  if (settings.automod_duplicate_enabled && normalized.length >= 3) {
    const recent = remember(duplicateHistory, key, { time: Date.now(), content: normalized, channelId: message.channel.id }, windowMs);
    const duplicateCount = recent.filter(item => item.content === normalized && item.channelId === message.channel.id).length;
    if (duplicateCount >= 3) {
      duplicateHistory.delete(key);
      return applyAction(message, 'repeated duplicate messages', settings);
    }
  }

  if (settings.automod_bad_words_enabled) {
    const words = new Set(content.toLowerCase().replace(/[^a-z0-9]+/gi, ' ').split(/\s+/).filter(Boolean));
    if (BAD_WORDS.some(word => words.has(word))) return applyAction(message, 'blocked word filter', settings);
  }

  if (settings.automod_mention_enabled) {
    if (message.mentions.everyone) return applyAction(message, '@everyone/@here mass mention', settings);
    const mentionCount = message.mentions.users.size + message.mentions.roles.size;
    if (mentionCount > settings.automod_max_mentions) {
      return applyAction(message, `too many mentions (${mentionCount})`, settings);
    }
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
  settingsCache.delete(guildId);
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
  for (const [guildId, entry] of settingsCache) {
    if (now - entry.time > SETTINGS_CACHE_MS) settingsCache.delete(guildId);
  }
}, 60_000).unref();

module.exports = { handleMessage, clearGuild };
