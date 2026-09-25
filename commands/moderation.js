const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { query } = require('../database/database');
const { logEvent } = require('../utils/logging');

async function recordCase(interaction, targetId, action, reason, metadata = {}) {
  await query(
    `INSERT INTO moderation_cases (guild_id, target_id, moderator_id, action, reason, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [interaction.guildId, targetId, interaction.user.id, action, reason || 'No reason provided', JSON.stringify(metadata)],
  ).catch(error => console.error('[Moderation] Case record failed:', error.message));
}

async function replyError(interaction, message) {
  return interaction.reply({ content: `❌ ${message}`, ephemeral: true });
}

function targetIsProtected(interaction, member) {
  if (!member) return 'That user is not in this server.';
  if (member.id === interaction.user.id) return 'You cannot moderate yourself.';
  if (member.id === interaction.guild.ownerId) return 'The server owner cannot be moderated by the bot.';
  if (interaction.member.roles.highest.comparePositionTo(member.roles.highest) <= 0) return 'That user has an equal or higher role than you.';
  if (!member.manageable) return 'My role is not high enough to manage that user.';
  return null;
}

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('ban').setDescription('Ban a member.')
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addUserOption(o => o.setName('user').setDescription('Member to ban.').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason.').setRequired(false)),
    async execute(interaction) {
      const member = await interaction.guild.members.fetch(interaction.options.getUser('user').id).catch(() => null);
      const error = targetIsProtected(interaction, member);
      if (error) return replyError(interaction, error);
      const reason = interaction.options.getString('reason') || 'No reason provided';
      await member.ban({ reason });
      await recordCase(interaction, member.id, 'ban', reason);
      await interaction.reply(`🔨 Banned **${member.user.tag}** — ${reason}`);
      await logEvent(interaction.client, interaction.guild, 'Member banned', `${member.user.tag} was banned.`, [
        { name: 'Moderator', value: interaction.user.tag, inline: true },
        { name: 'Reason', value: reason, inline: true },
      ]);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('kick').setDescription('Kick a member.')
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
      .addUserOption(o => o.setName('user').setDescription('Member to kick.').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason.').setRequired(false)),
    async execute(interaction) {
      const member = await interaction.guild.members.fetch(interaction.options.getUser('user').id).catch(() => null);
      const error = targetIsProtected(interaction, member);
      if (error) return replyError(interaction, error);
      const reason = interaction.options.getString('reason') || 'No reason provided';
      await member.kick(reason);
      await recordCase(interaction, member.id, 'kick', reason);
      await interaction.reply(`👢 Kicked **${member.user.tag}** — ${reason}`);
      await logEvent(interaction.client, interaction.guild, 'Member kicked', `${member.user.tag} was kicked.`, [
        { name: 'Moderator', value: interaction.user.tag, inline: true },
        { name: 'Reason', value: reason, inline: true },
      ]);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('timeout').setDescription('Timeout a member for up to 28 days.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption(o => o.setName('user').setDescription('Member to timeout.').setRequired(true))
      .addIntegerOption(o => o.setName('minutes').setDescription('Timeout duration in minutes.').setMinValue(1).setMaxValue(40320).setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason.').setRequired(false)),
    async execute(interaction) {
      const member = await interaction.guild.members.fetch(interaction.options.getUser('user').id).catch(() => null);
      const error = targetIsProtected(interaction, member);
      if (error) return replyError(interaction, error);
      const minutes = interaction.options.getInteger('minutes');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      await member.timeout(minutes * 60 * 1000, reason);
      await recordCase(interaction, member.id, 'timeout', reason, { minutes });
      await interaction.reply(`⏳ Timed out **${member.user.tag}** for ${minutes} minute(s) — ${reason}`);
      await logEvent(interaction.client, interaction.guild, 'Member timed out', `${member.user.tag} was timed out.`, [
        { name: 'Moderator', value: interaction.user.tag, inline: true },
        { name: 'Duration', value: `${minutes} minute(s)`, inline: true },
        { name: 'Reason', value: reason, inline: true },
      ]);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('untimeout').setDescription('Remove a member timeout.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption(o => o.setName('user').setDescription('Member.').setRequired(true)),
    async execute(interaction) {
      const member = await interaction.guild.members.fetch(interaction.options.getUser('user').id).catch(() => null);
      const error = targetIsProtected(interaction, member);
      if (error) return replyError(interaction, error);
      const reason = `Timeout removed by ${interaction.user.tag}`;
      await member.timeout(null, reason);
      await recordCase(interaction, member.id, 'untimeout', reason);
      await interaction.reply(`✅ Removed timeout from **${member.user.tag}**.`);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('warn').setDescription('Warn a member and save the warning.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption(o => o.setName('user').setDescription('Member to warn.').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason.').setRequired(true)),
    async execute(interaction) {
      const user = interaction.options.getUser('user');
      if (user.id === interaction.user.id) return replyError(interaction, 'You cannot warn yourself.');
      const reason = interaction.options.getString('reason');
      try {
        const result = await query(
          'INSERT INTO warnings (guild_id, user_id, moderator_id, reason) VALUES ($1, $2, $3, $4) RETURNING id',
          [interaction.guildId, user.id, interaction.user.id, reason],
        );
        await recordCase(interaction, user.id, 'warn', reason, { warning_id: result.rows[0].id });
        await interaction.reply(`⚠️ Warned **${user.tag}**. Warning #${result.rows[0].id} — ${reason}`);
        await logEvent(interaction.client, interaction.guild, 'Member warned', `${user.tag} received warning #${result.rows[0].id}.`, [
          { name: 'Moderator', value: interaction.user.tag, inline: true },
          { name: 'Reason', value: reason, inline: true },
        ]);
      } catch {
        return replyError(interaction, 'Warnings need PostgreSQL configured through `DATABASE_URL`.');
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('unwarn').setDescription('Remove a saved warning from a member.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption(o => o.setName('user').setDescription('Member.').setRequired(true))
      .addIntegerOption(o => o.setName('warning_id').setDescription('Warning ID to remove.').setMinValue(1).setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason for removing the warning.').setMaxLength(500)),
    async execute(interaction) {
      const user = interaction.options.getUser('user');
      const warningId = interaction.options.getInteger('warning_id');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      try {
        const result = await query(
          'DELETE FROM warnings WHERE id = $1 AND guild_id = $2 AND user_id = $3 RETURNING id, reason',
          [warningId, interaction.guildId, user.id],
        );
        if (!result.rows.length) return replyError(interaction, 'That warning was not found for this member.');
        await recordCase(interaction, user.id, 'unwarn', reason, {
          removed_warning_id: result.rows[0].id,
          removed_warning_reason: result.rows[0].reason,
        });
        await interaction.reply(`✅ Removed warning #${warningId} from **${user.tag}** — ${reason}`);
        await logEvent(interaction.client, interaction.guild, 'Warning removed', `${user.tag} had warning #${warningId} removed.`, [
          { name: 'Moderator', value: interaction.user.tag, inline: true },
          { name: 'Reason', value: reason, inline: true },
        ]);
      } catch (error) {
        console.error('[Unwarn]', error);
        return replyError(interaction, 'Warnings need PostgreSQL configured through `DATABASE_URL`.');
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('warnings').setDescription('View a member’s saved warnings.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption(o => o.setName('user').setDescription('Member.').setRequired(true)),
    async execute(interaction) {
      const user = interaction.options.getUser('user');
      try {
        const result = await query(
          'SELECT id, moderator_id, reason, created_at FROM warnings WHERE guild_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 20',
          [interaction.guildId, user.id],
        );
        if (!result.rows.length) return interaction.reply(`No warnings found for **${user.tag}**.`);
        const description = result.rows.map(w => `**#${w.id}** — ${w.reason}\nModerator: <@${w.moderator_id}> • <t:${Math.floor(new Date(w.created_at).getTime() / 1000)}:R>`).join('\n\n');
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`Warnings — ${user.tag}`).setDescription(description)] });
      } catch {
        return replyError(interaction, 'Warnings need PostgreSQL configured through `DATABASE_URL`.');
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('clear').setDescription('Delete up to 100 recent messages.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addIntegerOption(o => o.setName('amount').setDescription('Number of messages.').setMinValue(1).setMaxValue(100).setRequired(true)),
    async execute(interaction) {
      const amount = interaction.options.getInteger('amount');
      const deleted = await interaction.channel.bulkDelete(amount, true);
      await recordCase(interaction, interaction.user.id, 'clear', `Deleted ${deleted.size} message(s)`, { channel_id: interaction.channel.id, requested_amount: amount });
      await interaction.reply({ content: `🧹 Deleted ${deleted.size} message(s).`, ephemeral: true });
      await logEvent(interaction.client, interaction.guild, 'Messages cleared', `${deleted.size} message(s) deleted in ${interaction.channel}.`, [
        { name: 'Moderator', value: interaction.user.tag, inline: true },
      ]);
    },
  },
];

module.exports = commands;
