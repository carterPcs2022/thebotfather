const { PermissionFlagsBits } = require('discord.js');
const { query } = require('../database/database');
const { logEvent } = require('../utils/logging');

function stripQuotes(value) {
  return value?.replace(/^["']|["']$/g, '').trim();
}

async function resolveMember(guild, input) {
  const token = stripQuotes(input);
  if (!token) return null;

  const mention = token.match(/^<@!?(\d+)>$/);
  const id = mention?.[1] || (/^\d{15,25}$/.test(token) ? token : null);
  if (id) return guild.members.fetch(id).catch(() => null);

  const exact = guild.members.cache.find(member =>
    member.user.username.toLowerCase() === token.toLowerCase()
    || member.user.globalName?.toLowerCase() === token.toLowerCase()
    || member.displayName.toLowerCase() === token.toLowerCase()
    || member.user.tag.toLowerCase() === token.toLowerCase()
  );
  if (exact) return exact;

  const results = await guild.members.fetch({ query: token, limit: 10 }).catch(() => null);
  return results?.find(member =>
    member.user.username.toLowerCase() === token.toLowerCase()
    || member.user.globalName?.toLowerCase() === token.toLowerCase()
    || member.displayName.toLowerCase() === token.toLowerCase()
  ) || null;
}

function moderatorCanManage(message, member, permission) {
  if (!message.member.permissions.has(permission)) return 'You do not have permission to use that command.';
  if (!message.guild.members.me?.permissions.has(permission)) return 'The Bot Father does not have the required Discord permission.';
  if (!member) return 'I could not find that member. Use their @mention, username, or Discord ID.';
  if (member.id === message.author.id) return 'You cannot moderate yourself.';
  if (member.id === message.guild.ownerId) return 'The server owner cannot be moderated.';
  if (message.member.roles.highest.comparePositionTo(member.roles.highest) <= 0) return 'That member has an equal or higher role than you.';
  if (!member.manageable) return 'My role is not high enough to manage that member. Move The Bot Father role above their role.';
  return null;
}

function parseArgs(text) {
  const match = text.trim().match(/^(\S+)(?:\s+(.+))?$/);
  if (!match) return [];
  const first = match[1];
  const rest = match[2]?.trim() || '';
  return [first, rest];
}

async function handleMentionCommand(message) {
  if (!message.guild || message.author.bot) return false;

  const botId = message.client.user.id;
  const mentionPattern = new RegExp('^<@!?' + botId + '>\\s*');
  if (!mentionPattern.test(message.content)) return false;

  const body = message.content.replace(mentionPattern, '').trim();
  if (!body) {
    await message.reply('👋 I\'m here. Try `@The Bot Father help` or `@The Bot Father ban @user reason`.');
    return true;
  }

  const commandMatch = body.match(/^\S+/);
  const command = commandMatch?.[0]?.toLowerCase();
  const remainder = body.slice(commandMatch[0].length).trim();

  if (['help', 'commands'].includes(command)) {
    await message.reply([
      '**🤖 The Bot Father — mention commands**',
      '`@Bot ban @user reason`',
      '`@Bot kick @user reason`',
      '`@Bot timeout @user 10m reason`',
      '`@Bot warn @user reason`',
      '`@Bot untimeout @user`',
      '`@Bot purge 10`',
      '`@Bot slowmode 10`',
      '`@Bot lock` / `@Bot unlock`',
      '',
      'Slash commands are still available too.',
    ].join('\n'));
    return true;
  }

  try {
    if (command === 'lock' || command === 'unlock') {
      if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        await message.reply('❌ You do not have permission to manage channels.');
        return true;
      }
      if (!message.guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
        await message.reply('❌ I do not have Manage Channels permission here.');
        return true;
      }
      await message.channel.permissionOverwrites.edit(
        message.guild.roles.everyone,
        { SendMessages: command === 'lock' ? false : null },
      );
      await message.reply(command === 'lock' ? '🔒 Channel locked.' : '🔓 Channel unlocked.');
      return true;
    }

    if (command === 'purge' || command === 'clear') {
      if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        await message.reply('❌ You do not have permission to manage messages.');
        return true;
      }
      const amount = Number(remainder);
      if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
        await message.reply('❌ Give me a number from 1 to 100. Example: `@Bot purge 25`');
        return true;
      }
      const deleted = await message.channel.bulkDelete(amount, true);
      await message.reply(`🧹 Deleted ${deleted.size} message(s).`);
      return true;
    }

    if (command === 'slowmode') {
      if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        await message.reply('❌ You do not have permission to manage channels.');
        return true;
      }
      const seconds = Number(remainder);
      if (!Number.isInteger(seconds) || seconds < 0 || seconds > 21600) {
        await message.reply('❌ Give me a number of seconds from 0 to 21600.');
        return true;
      }
      await message.channel.setRateLimitPerUser(seconds, `Changed by ${message.author.tag}`);
      await message.reply(`🐢 Slowmode set to **${seconds}s**.`);
      return true;
    }

    if (['ban', 'kick', 'warn', 'untimeout', 'timeout'].includes(command)) {
      const parts = parseArgs(remainder);
      const targetInput = parts[0];
      let reason = parts[1] || 'No reason provided';

      if (command === 'timeout') {
        const timeoutMatch = reason.match(/^(\d+)(s|m|h|d)?(?:\s+(.+))?$/i);
        if (!timeoutMatch) {
          await message.reply('❌ Timeout format: `@Bot timeout @user 10m reason`');
          return true;
        }
        const amount = Number(timeoutMatch[1]);
        const unit = (timeoutMatch[2] || 'm').toLowerCase();
        const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[unit];
        const seconds = amount * multiplier;
        if (seconds < 1 || seconds > 28 * 86400) {
          await message.reply('❌ Timeout must be between 1 second and 28 days.');
          return true;
        }
        reason = timeoutMatch[3] || 'No reason provided';
        const member = await resolveMember(message.guild, targetInput);
        const error = moderatorCanManage(message, member, PermissionFlagsBits.ModerateMembers);
        if (error) { await message.reply(`❌ ${error}`); return true; }
        await member.timeout(seconds * 1000, reason);
        void query(
          `INSERT INTO moderation_cases (guild_id, target_id, moderator_id, action, reason, metadata)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
          [message.guild.id, member.id, message.author.id, 'timeout', reason, JSON.stringify({ seconds })],
        ).catch(error => console.error('[TextModeration] Timeout audit failed:', error.message));
        await message.reply(`⏳ Timed out **${member.user.tag}** for ${amount}${unit} — ${reason}`);
        return true;
      }

      const permission = command === 'ban'
        ? PermissionFlagsBits.BanMembers
        : command === 'kick'
          ? PermissionFlagsBits.KickMembers
          : PermissionFlagsBits.ModerateMembers;
      const member = await resolveMember(message.guild, targetInput);
      const error = moderatorCanManage(message, member, permission);
      if (error) { await message.reply(`❌ ${error}`); return true; }

      if (command === 'ban') {
        await member.ban({ reason });
        void query(
          `INSERT INTO moderation_cases (guild_id, target_id, moderator_id, action, reason, metadata)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
          [message.guild.id, member.id, message.author.id, 'ban', reason, '{}'],
        ).catch(error => console.error('[TextModeration] Ban audit failed:', error.message));
        await logEvent(message.client, message.guild, 'Member banned', `${member.user.tag} was banned.`, [
          { name: 'Moderator', value: message.author.tag, inline: true },
          { name: 'Reason', value: reason, inline: true },
        ]);
        await message.reply(`🔨 Banned **${member.user.tag}** — ${reason}`);
      } else if (command === 'kick') {
        await member.kick(reason);
        void query(
          `INSERT INTO moderation_cases (guild_id, target_id, moderator_id, action, reason, metadata)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
          [message.guild.id, member.id, message.author.id, 'kick', reason, '{}'],
        ).catch(error => console.error('[TextModeration] Kick audit failed:', error.message));
        await logEvent(message.client, message.guild, 'Member kicked', `${member.user.tag} was kicked.`, [
          { name: 'Moderator', value: message.author.tag, inline: true },
          { name: 'Reason', value: reason, inline: true },
        ]);
        await message.reply(`👢 Kicked **${member.user.tag}** — ${reason}`);
      } else if (command === 'untimeout') {
        await member.timeout(null, `Timeout removed by ${message.author.tag}`);
        await message.reply(`✅ Removed timeout from **${member.user.tag}**.`);
      } else {
        const target = member.user;
        const warningReason = parts[1] || 'No reason provided';
        const result = await query(
          'INSERT INTO warnings (guild_id, user_id, moderator_id, reason) VALUES ($1, $2, $3, $4) RETURNING id',
          [message.guild.id, target.id, message.author.id, warningReason],
        );
        await message.reply(`⚠️ Warned **${target.tag}**. Warning #${result.rows[0].id} — ${warningReason}`);
      }
      return true;
    }

    await message.reply('❓ I don\'t know that command. Try `@Bot help`.');
    return true;
  } catch (error) {
    console.error('[TextCommands]', error);
    await message.reply(`❌ I couldn't complete that command: ${error.message || 'unknown Discord error'}`).catch(() => null);
    return true;
  }
}

module.exports = { handleMentionCommand };
