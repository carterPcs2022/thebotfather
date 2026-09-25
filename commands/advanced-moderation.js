const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { query } = require('../database/database');
const { logEvent } = require('../utils/logging');

async function replyError(interaction, message) {
  return interaction.reply({ content: `❌ ${message}`, ephemeral: true });
}

function protectedTarget(interaction, member) {
  if (!member) return 'That user is not in this server.';
  if (member.id === interaction.user.id) return 'You cannot moderate yourself.';
  if (member.id === interaction.guild.ownerId) return 'The server owner cannot be moderated.';
  if (interaction.member.roles.highest.comparePositionTo(member.roles.highest) <= 0) return 'That user has an equal or higher role than you.';
  if (!member.manageable) return 'My role is not high enough to manage that user.';
  return null;
}

function record(interaction, targetId, action, reason, metadata = {}) {
  void query(
    `INSERT INTO moderation_cases (guild_id, target_id, moderator_id, action, reason, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [interaction.guildId, targetId, interaction.user.id, action, reason, JSON.stringify(metadata)],
  ).catch(error => console.error('[Moderation] Case record failed:', error.message));
}

const commands = [
  {
    data: new SlashCommandBuilder().setName('unban').setDescription('Unban a user by ID.')
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addStringOption(o => o.setName('user_id').setDescription('Discord user ID.').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason.')),
    async execute(i) {
      const id = i.options.getString('user_id');
      const reason = i.options.getString('reason') || 'No reason provided';
      try { await i.guild.members.unban(id, reason); }
      catch { return replyError(i, 'That user is not banned, or the ID is invalid.'); }
      await record(i, id, 'unban', reason);
      await i.reply(`✅ Unbanned **${id}** — ${reason}`);
      await logEvent(i.client, i.guild, 'Member unbanned', `User ${id} was unbanned.`, [{ name: 'Moderator', value: i.user.tag }, { name: 'Reason', value: reason }]);
    },
  },
  {
    data: new SlashCommandBuilder().setName('softban').setDescription('Ban then immediately unban a member to remove recent messages.')
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addUserOption(o => o.setName('user').setDescription('Member.').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason.')),
    async execute(i) {
      const member = await i.guild.members.fetch(i.options.getUser('user').id).catch(() => null);
      const error = protectedTarget(i, member); if (error) return replyError(i, error);
      const reason = i.options.getString('reason') || 'No reason provided';
      await member.ban({ deleteMessageSeconds: 7 * 24 * 60 * 60, reason });
      await i.guild.members.unban(member.id, `Softban completed: ${reason}`);
      await record(i, member.id, 'softban', reason);
      await i.reply(`🧹 Softbanned **${member.user.tag}** — ${reason}`);
      await logEvent(i.client, i.guild, 'Member softbanned', `${member.user.tag} was softbanned.`, [{ name: 'Moderator', value: i.user.tag }, { name: 'Reason', value: reason }]);
    },
  },
  {
    data: new SlashCommandBuilder().setName('purge').setDescription('Delete recent messages from this channel.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addIntegerOption(o => o.setName('amount').setDescription('1-100 messages.').setMinValue(1).setMaxValue(100).setRequired(true)),
    async execute(i) {
      const deleted = await i.channel.bulkDelete(i.options.getInteger('amount'), true);
      const reason = 'Manual message purge';
      await record(i, i.channel.id, 'purge', reason, { deleted: deleted.size, requested_amount: i.options.getInteger('amount') });
      await i.reply({ content: `🧹 Deleted ${deleted.size} message(s).`, ephemeral: true });
      await logEvent(i.client, i.guild, 'Messages purged', `${deleted.size} message(s) deleted in ${i.channel}.`, [{ name: 'Moderator', value: i.user.tag }]);
    },
  },
  {
    data: new SlashCommandBuilder().setName('slowmode').setDescription('Set channel slowmode.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
      .addIntegerOption(o => o.setName('seconds').setDescription('0-21600 seconds.').setMinValue(0).setMaxValue(21600).setRequired(true)),
    async execute(i) {
      const seconds = i.options.getInteger('seconds');
      const reason = `Slowmode set to ${seconds} seconds`;
      await i.channel.setRateLimitPerUser(seconds, `${reason} by ${i.user.tag}`);
      await record(i, i.channel.id, 'slowmode', reason, { seconds });
      await i.reply(`🐢 Slowmode set to **${seconds}s**.`);
    },
  },
  {
    data: new SlashCommandBuilder().setName('lock').setDescription('Lock this channel for @everyone.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    async execute(i) {
      const reason = 'Channel locked';
      await i.channel.permissionOverwrites.edit(i.guild.roles.everyone, { SendMessages: false });
      await record(i, i.channel.id, 'lock', reason);
      await i.reply(`🔒 ${i.channel} is now locked.`);
    },
  },
  {
    data: new SlashCommandBuilder().setName('unlock').setDescription('Unlock this channel for @everyone.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    async execute(i) {
      const reason = 'Channel unlocked';
      await i.channel.permissionOverwrites.edit(i.guild.roles.everyone, { SendMessages: null });
      await record(i, i.channel.id, 'unlock', reason);
      await i.reply(`🔓 ${i.channel} is now unlocked.`);
    },
  },
  {
    data: new SlashCommandBuilder().setName('nick').setDescription('Change a member nickname.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
      .addUserOption(o => o.setName('user').setDescription('Member.').setRequired(true))
      .addStringOption(o => o.setName('nickname').setDescription('New nickname; leave blank to clear.').setMaxLength(32).setRequired(false)),
    async execute(i) {
      const member = await i.guild.members.fetch(i.options.getUser('user').id).catch(() => null);
      const error = protectedTarget(i, member); if (error) return replyError(i, error);
      const nickname = i.options.getString('nickname') || null;
      const reason = nickname ? `Nickname changed to ${nickname}` : 'Nickname cleared';
      await member.setNickname(nickname, `${reason} by ${i.user.tag}`);
      await record(i, member.id, 'nick', reason, { nickname });
      await i.reply(`🏷️ Nickname updated for **${member.user.tag}**.`);
    },
  },
];

module.exports = commands;
