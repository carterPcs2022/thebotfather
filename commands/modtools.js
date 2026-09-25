const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { query } = require('../database/database');

const commands = [

  {
    data: new SlashCommandBuilder()
      .setName('modcase')
      .setDescription('View a moderation case by its case ID.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addIntegerOption(o => o.setName('case_id').setDescription('Moderation case ID.').setMinValue(1).setRequired(true)),
    async execute(interaction) {
      await interaction.deferReply({ ephemeral: true });
      const caseId = interaction.options.getInteger('case_id');
      try {
        const result = await query(
          'SELECT id, target_id, action, reason, moderator_id, metadata, created_at FROM moderation_cases WHERE guild_id = $1 AND id = $2',
          [interaction.guildId, caseId],
        );
        const row = result.rows[0];
        if (!row) return interaction.editReply({ content: `❌ Moderation case **#${caseId}** was not found in this server.` });
        const metadata = row.metadata && Object.keys(row.metadata).length
          ? JSON.stringify(row.metadata, null, 2).slice(0, 900)
          : 'None';
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setTitle(`Moderation Case #${row.id}`)
            .addFields(
              { name: 'Action', value: row.action, inline: true },
              { name: 'Target', value: `<@${row.target_id}>`, inline: true },
              { name: 'Moderator', value: `<@${row.moderator_id}>`, inline: true },
              { name: 'Reason', value: row.reason || 'No reason provided' },
              { name: 'Metadata', value: `\\`\\`\\`json\\n${metadata}\\n\\`\\`\\`` },
              { name: 'Created', value: `<t:${Math.floor(new Date(row.created_at).getTime() / 1000)}:F>` },
            )],
        });
      } catch (error) {
        console.error('[ModCase]', error);
        return interaction.editReply({ content: '❌ PostgreSQL is required for moderation cases.' });
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('modlogs')
      .setDescription('View recent moderation cases for a member.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption(o => o.setName('user').setDescription('Member.').setRequired(true)),
    async execute(interaction) {
      await interaction.deferReply({ ephemeral: true });
      const user = interaction.options.getUser('user');
      try {
        const result = await query(
          'SELECT id, action, reason, moderator_id, created_at FROM moderation_cases WHERE guild_id = $1 AND target_id = $2 ORDER BY created_at DESC LIMIT 15',
          [interaction.guildId, user.id],
        );
        if (!result.rows.length) {
          return interaction.editReply({ content: `No moderation cases found for **${user.tag}**.` });
        }
        const description = result.rows.map(row =>
          `**#${row.id} — ${row.action}**\n${row.reason}\nModerator: <@${row.moderator_id}> • <t:${Math.floor(new Date(row.created_at).getTime() / 1000)}:R>`
        ).join('\n\n');
        return interaction.editReply({
          embeds: [new EmbedBuilder().setTitle(`Moderation Logs — ${user.tag}`).setDescription(description).setFooter({ text: 'Showing up to 15 recent cases.' })],
          ephemeral: true,
        });
      } catch (error) {
        console.error('[ModLogs]', error);
        return interaction.editReply({ content: '❌ PostgreSQL is required for moderation logs.' });
      }
    },
  },
];

module.exports = commands;
