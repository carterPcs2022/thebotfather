const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const { query } = require('../database/database');

const command = {
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Create and manage scheduled messages.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub => sub.setName('create').setDescription('Schedule a message.')
      .addChannelOption(o => o.setName('channel').setDescription('Where to send it.').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption(o => o.setName('message').setDescription('Message to send.').setMaxLength(2000).setRequired(true))
      .addIntegerOption(o => o.setName('delay_minutes').setDescription('Minutes until the first message.').setMinValue(1).setMaxValue(525600).setRequired(true))
      .addIntegerOption(o => o.setName('repeat_minutes').setDescription('Repeat every N minutes. Leave 0 for one-time.').setMinValue(0).setMaxValue(525600)))
    .addSubcommand(sub => sub.setName('list').setDescription('List scheduled messages.'))
    .addSubcommand(sub => sub.setName('delete').setDescription('Delete a scheduled message.')
      .addIntegerOption(o => o.setName('id').setDescription('Schedule ID.').setMinValue(1).setRequired(true))),
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    try {
      const sub = interaction.options.getSubcommand();
      if (sub === 'create') {
        const channel = interaction.options.getChannel('channel', true);
        const content = interaction.options.getString('message', true);
        const delay = interaction.options.getInteger('delay_minutes', true);
        const repeat = interaction.options.getInteger('repeat_minutes') || 0;
        const next = new Date(Date.now() + delay * 60000);
        const result = await query(
          'INSERT INTO scheduled_messages (guild_id, channel_id, creator_id, content, next_run_at, repeat_minutes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, next_run_at',
          [interaction.guildId, channel.id, interaction.user.id, content, next, repeat],
        );
        const row = result.rows[0];
        return interaction.editReply('✅ Schedule #' + row.id + ' created for ' + channel + '. First message: <t:' + Math.floor(new Date(row.next_run_at).getTime() / 1000) + ':R>' + (repeat ? ' • repeats every ' + repeat + ' minute(s).' : ' • one-time.'));
      }
      if (sub === 'list') {
        const result = await query(
          'SELECT id, channel_id, content, next_run_at, repeat_minutes FROM scheduled_messages WHERE guild_id = $1 AND active = TRUE ORDER BY next_run_at ASC LIMIT 25',
          [interaction.guildId],
        );
        if (!result.rows.length) return interaction.editReply('No active scheduled messages.');
        const description = result.rows.map(row =>
          '**#' + row.id + '** • <#' + row.channel_id + '> • <t:' + Math.floor(new Date(row.next_run_at).getTime() / 1000) + ':R>' + (row.repeat_minutes ? ' • every ' + row.repeat_minutes + 'm' : '') + '\n' + row.content.slice(0, 150)
        ).join('\n\n');
        return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('📅 Scheduled Messages').setDescription(description)] });
      }
      const id = interaction.options.getInteger('id', true);
      const result = await query('UPDATE scheduled_messages SET active = FALSE WHERE guild_id = $1 AND id = $2 AND active = TRUE RETURNING id', [interaction.guildId, id]);
      return interaction.editReply(result.rowCount ? '🗑️ Schedule #' + id + ' deleted.' : '❌ Active schedule #' + id + ' was not found.');
    } catch (error) {
      console.error('[Schedule]', error);
      return interaction.editReply('❌ Could not update scheduled messages. Make sure PostgreSQL is configured.');
    }
  },
};

module.exports = { command };
