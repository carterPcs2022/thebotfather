const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { query } = require('../database/database');
const { getSettings } = require('./config');

function suggestionEmbed(row) {
  const status = row.status === 'approved' ? '✅ Approved' : row.status === 'denied' ? '❌ Denied' : '🟡 Pending';
  return new EmbedBuilder()
    .setTitle(`💡 Suggestion #${row.id}`)
    .setDescription(row.content)
    .addFields(
      { name: 'Status', value: status, inline: true },
      { name: 'Votes', value: `👍 ${row.upvotes}  |  👎 ${row.downvotes}`, inline: true },
    )
    .setFooter({ text: `Submitted by ${row.author_id}` });
}

function suggestionButtons(id, disabled = false) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`suggestion:up:${id}`).setLabel('Upvote').setEmoji('👍').setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`suggestion:down:${id}`).setLabel('Downvote').setEmoji('👎').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  )];
}

async function refreshSuggestion(client, row) {
  const channel = await client.channels.fetch(row.channel_id).catch(() => null);
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(row.message_id).catch(() => null);
  if (message) await message.edit({ embeds: [suggestionEmbed(row)], components: suggestionButtons(row.id, row.status !== 'pending') }).catch(() => null);
}

async function handleSuggestionButton(interaction) {
  if (!interaction.customId.startsWith('suggestion:')) return false;
  const [, action, id] = interaction.customId.split(':');
  const result = await query('SELECT * FROM suggestions WHERE id = $1', [id]);
  const row = result.rows[0];

  if (!row || row.status !== 'pending') {
    await interaction.reply({ content: 'This suggestion is no longer open for voting.', ephemeral: true });
    return true;
  }

  await query('DELETE FROM suggestion_votes WHERE suggestion_id = $1 AND user_id = $2', [id, interaction.user.id]);
  await query('INSERT INTO suggestion_votes (suggestion_id, user_id, vote) VALUES ($1,$2,$3)', [id, interaction.user.id, action === 'up' ? 1 : -1]);

  const counts = await query('SELECT vote, COUNT(*)::int AS count FROM suggestion_votes WHERE suggestion_id = $1 GROUP BY vote', [id]);
  row.upvotes = counts.rows.find(v => Number(v.vote) === 1)?.count || 0;
  row.downvotes = counts.rows.find(v => Number(v.vote) === -1)?.count || 0;
  await refreshSuggestion(interaction.client, row);
  await interaction.reply({ content: action === 'up' ? '👍 Upvote recorded.' : '👎 Downvote recorded.', ephemeral: true });
  return true;
}

const command = {
  data: new SlashCommandBuilder()
    .setName('suggestion')
    .setDescription('Create and manage server suggestions.')
    .addSubcommand(sub => sub.setName('create').setDescription('Submit a suggestion.')
      .addStringOption(o => o.setName('content').setDescription('Your suggestion.').setMaxLength(1000).setRequired(true)))
    .addSubcommand(sub => sub.setName('approve').setDescription('Approve a suggestion.')
      .addIntegerOption(o => o.setName('id').setDescription('Suggestion ID.').setMinValue(1).setRequired(true))
      .addStringOption(o => o.setName('response').setDescription('Optional staff response.').setMaxLength(500)))
    .addSubcommand(sub => sub.setName('deny').setDescription('Deny a suggestion.')
      .addIntegerOption(o => o.setName('id').setDescription('Suggestion ID.').setMinValue(1).setRequired(true))
      .addStringOption(o => o.setName('response').setDescription('Optional staff response.').setMaxLength(500)))
    .addSubcommand(sub => sub.setName('status').setDescription('View a suggestion.')
      .addIntegerOption(o => o.setName('id').setDescription('Suggestion ID.').setMinValue(1).setRequired(true))),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') {
      const settings = await getSettings(interaction.guildId);
      if (!settings.suggestion_channel_id) return interaction.reply({ content: '❌ Suggestions are not configured. Ask a server manager to set the suggestion channel.', ephemeral: true });
      const channel = await interaction.guild.channels.fetch(settings.suggestion_channel_id).catch(() => null);
      if (!channel?.isTextBased()) return interaction.reply({ content: '❌ The configured suggestion channel is unavailable.', ephemeral: true });

      const content = interaction.options.getString('content');
      const placeholder = await channel.send({ content: 'Creating suggestion…' });
      const result = await query(
        'INSERT INTO suggestions (guild_id, channel_id, message_id, author_id, content) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [interaction.guildId, channel.id, placeholder.id, interaction.user.id, content],
      );
      const row = result.rows[0];
      await placeholder.edit({ content: '', embeds: [suggestionEmbed(row)], components: suggestionButtons(row.id) });
      return interaction.reply({ content: `✅ Suggestion #${row.id} submitted!`, ephemeral: true });
    }

    const id = interaction.options.getInteger('id');
    const result = await query('SELECT * FROM suggestions WHERE id = $1 AND guild_id = $2', [id, interaction.guildId]);
    const row = result.rows[0];
    if (!row) return interaction.reply({ content: '❌ Suggestion not found.', ephemeral: true });

    if (sub === 'status') {
      return interaction.reply({ ephemeral: true, embeds: [suggestionEmbed(row)] });
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: '❌ You need Manage Server to moderate suggestions.', ephemeral: true });
    }

    const status = sub === 'approve' ? 'approved' : 'denied';
    const response = interaction.options.getString('response');
    await query('UPDATE suggestions SET status = $1, staff_response = $2, reviewed_by = $3, reviewed_at = NOW() WHERE id = $4', [status, response, interaction.user.id, id]);
    const updated = { ...row, status, staff_response: response, reviewed_by: interaction.user.id };
    await refreshSuggestion(interaction.client, updated);

    if (response) await interaction.followUp({ content: `Staff response: ${response}`, ephemeral: false }).catch(() => null);
    return interaction.reply({ content: `✅ Suggestion #${id} marked **${status}**.`, ephemeral: true });
  },
};

module.exports = { command, handleSuggestionButton };
