const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { query } = require('../database/database');

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('modlogs')
      .setDescription('View recent moderation cases for a member.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption(o => o.setName('user').setDescription('Member.').setRequired(true)),
    async execute(interaction) {
      const user = interaction.options.getUser('user');
      try {
        const result = await query(
          'SELECT id, action, reason, moderator_id, created_at FROM moderation_cases WHERE guild_id = $1 AND target_id = $2 ORDER BY created_at DESC LIMIT 15',
          [interaction.guildId, user.id],
        );
        if (!result.rows.length) {
          return interaction.reply({ content: `No moderation cases found for **${user.tag}**.`, ephemeral: true });
        }
        const description = result.rows.map(row =>
          `**#${row.id} — ${row.action}**\n${row.reason}\nModerator: <@${row.moderator_id}> • <t:${Math.floor(new Date(row.created_at).getTime() / 1000)}:R>`
        ).join('\n\n');
        return interaction.reply({
          embeds: [new EmbedBuilder().setTitle(`Moderation Logs — ${user.tag}`).setDescription(description).setFooter({ text: 'Showing up to 15 recent cases.' })],
          ephemeral: true,
        });
      } catch (error) {
        console.error('[ModLogs]', error);
        return interaction.reply({ content: '❌ PostgreSQL is required for moderation logs.', ephemeral: true });
      }
    },
  },
];

module.exports = commands;
