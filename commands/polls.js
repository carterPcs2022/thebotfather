const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { query } = require('../database/database');

const timers = new Map();

function parseOptions(row) {
  return Array.isArray(row.options) ? row.options : [];
}

function pollEmbed(row, counts = []) {
  const options = parseOptions(row);
  const total = counts.reduce((sum, n) => sum + n, 0);
  const lines = options.map((option, i) => {
    const count = counts[i] || 0;
    const pct = total ? Math.round((count / total) * 100) : 0;
    return `**${i + 1}. ${option}** — ${count} vote${count === 1 ? '' : 's'} (${pct}%)`;
  });
  const embed = new EmbedBuilder()
    .setTitle('📊 Poll')
    .setDescription(`**${row.question}**\\n\\n${lines.join('\\n')}`)
    .addFields(
      { name: 'Votes', value: String(total), inline: true },
      { name: 'Voting', value: row.multiple ? 'Multiple choices' : 'One choice', inline: true },
      { name: 'Privacy', value: row.anonymous ? 'Anonymous' : 'Public', inline: true },
    );
  if (row.closed) embed.setFooter({ text: 'This poll is closed.' });
  else if (row.ends_at) embed.setFooter({ text: `Ends <t:${Math.floor(new Date(row.ends_at).getTime() / 1000)}:R>` });
  return embed;
}

function pollButtons(row, disabled = false) {
  const options = parseOptions(row);
  const rows = [];
  for (let start = 0; start < options.length; start += 5) {
    const buttons = options.slice(start, start + 5).map((option, offset) =>
      new ButtonBuilder()
        .setCustomId(`poll:vote:${row.id}:${start + offset}`)
        .setLabel(String(start + offset + 1))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled)
    );
    rows.push(new ActionRowBuilder().addComponents(buttons));
  }
  return rows;
}

async function getCounts(id) {
  const result = await query(
    'SELECT option_index, COUNT(*)::int AS count FROM poll_votes WHERE poll_id = $1 GROUP BY option_index ORDER BY option_index',
    [id],
  );
  return result.rows.reduce((counts, row) => {
    counts[row.option_index] = Number(row.count);
    return counts;
  }, []);
}

async function renderPoll(client, row) {
  const channel = await client.channels.fetch(row.channel_id).catch(() => null);
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(row.message_id).catch(() => null);
  if (!message) return;
  const counts = await getCounts(row.id);
  await message.edit({ embeds: [pollEmbed(row, counts)], components: pollButtons(row, row.closed) }).catch(() => null);
}

async function closePoll(client, id) {
  const result = await query('SELECT * FROM polls WHERE id = $1', [id]);
  const row = result.rows[0];
  if (!row || row.closed) return false;
  await query('UPDATE polls SET closed = TRUE WHERE id = $1', [id]);
  timers.delete(String(id));
  await renderPoll(client, { ...row, closed: true });
  return true;
}

function schedulePoll(client, row) {
  if (!row.ends_at) return;
  const delay = Math.max(0, new Date(row.ends_at).getTime() - Date.now());
  if (timers.has(String(row.id))) clearTimeout(timers.get(String(row.id)));
  timers.set(String(row.id), setTimeout(() => closePoll(client, row.id).catch(console.error), delay));
}

async function restorePolls(client) {
  const result = await query('SELECT * FROM polls WHERE closed = FALSE ORDER BY ends_at ASC NULLS LAST');
  for (const row of result.rows) {
    if (row.ends_at && new Date(row.ends_at).getTime() <= Date.now()) await closePoll(client, row.id);
    else schedulePoll(client, row);
  }
  console.log(`[Polls] Restored ${result.rows.length} active poll(s).`);
}

async function handlePollButton(interaction) {
  if (!interaction.customId.startsWith('poll:vote:')) return false;
  const [, , id, optionText] = interaction.customId.split(':');
  const optionIndex = Number(optionText);
  const result = await query('SELECT * FROM polls WHERE id = $1', [id]);
  const poll = result.rows[0];

  if (!poll || poll.closed) {
    await interaction.reply({ content: 'This poll is closed.', ephemeral: true });
    return true;
  }
  if (poll.ends_at && new Date(poll.ends_at).getTime() <= Date.now()) {
    await closePoll(interaction.client, poll.id);
    await interaction.reply({ content: 'This poll just ended.', ephemeral: true });
    return true;
  }

  const options = parseOptions(poll);
  if (!Number.isInteger(optionIndex) || !options[optionIndex]) {
    await interaction.reply({ content: '❌ That poll option is no longer valid.', ephemeral: true });
    return true;
  }

  if (!poll.multiple) {
    const existing = await query('SELECT option_index FROM poll_votes WHERE poll_id = $1 AND user_id = $2 LIMIT 1', [id, interaction.user.id]);
    if (existing.rows.length) {
      await interaction.reply({ content: 'You already voted in this poll. 🎯', ephemeral: true });
      return true;
    }
  } else {
    const existing = await query('SELECT 1 FROM poll_votes WHERE poll_id = $1 AND user_id = $2 AND option_index = $3', [id, interaction.user.id, optionIndex]);
    if (existing.rows.length) {
      await interaction.reply({ content: 'You already selected that option.', ephemeral: true });
      return true;
    }
  }

  await query('INSERT INTO poll_votes (poll_id, user_id, option_index) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [id, interaction.user.id, optionIndex]);
  await renderPoll(interaction.client, poll);
  await interaction.reply({ content: `Vote recorded for **${options[optionIndex]}**! 📊`, ephemeral: true });
  return true;
}

const command = {
  data: new SlashCommandBuilder()
    .setName('poll').setDescription('Create and manage polls.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub => sub.setName('create').setDescription('Create a poll with up to 10 choices.')
      .addStringOption(o => o.setName('question').setDescription('Poll question.').setMaxLength(300).setRequired(true))
      .addStringOption(o => o.setName('option1').setDescription('First choice.').setMaxLength(100).setRequired(true))
      .addStringOption(o => o.setName('option2').setDescription('Second choice.').setMaxLength(100).setRequired(true))
      .addStringOption(o => o.setName('option3').setDescription('Third choice.').setMaxLength(100))
      .addStringOption(o => o.setName('option4').setDescription('Fourth choice.').setMaxLength(100))
      .addStringOption(o => o.setName('option5').setDescription('Fifth choice.').setMaxLength(100))
      .addStringOption(o => o.setName('option6').setDescription('Sixth choice.').setMaxLength(100))
      .addStringOption(o => o.setName('option7').setDescription('Seventh choice.').setMaxLength(100))
      .addStringOption(o => o.setName('option8').setDescription('Eighth choice.').setMaxLength(100))
      .addStringOption(o => o.setName('option9').setDescription('Ninth choice.').setMaxLength(100))
      .addStringOption(o => o.setName('option10').setDescription('Tenth choice.').setMaxLength(100))
      .addIntegerOption(o => o.setName('minutes').setDescription('Optional duration in minutes.').setMinValue(1).setMaxValue(10080))
      .addBooleanOption(o => o.setName('anonymous').setDescription('Hide voter identities from everyone.'))
      .addBooleanOption(o => o.setName('multiple').setDescription('Allow members to choose more than one option.')))
    .addSubcommand(sub => sub.setName('close').setDescription('Close a poll.')
      .addIntegerOption(o => o.setName('id').setDescription('Poll ID.').setMinValue(1).setRequired(true)))
    .addSubcommand(sub => sub.setName('results').setDescription('Show poll results.')
      .addIntegerOption(o => o.setName('id').setDescription('Poll ID.').setMinValue(1).setRequired(true))),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      const question = interaction.options.getString('question');
      const options = [];
      for (let i = 1; i <= 10; i += 1) {
        const value = interaction.options.getString(`option${i}`);
        if (value) options.push(value);
      }
      const minutes = interaction.options.getInteger('minutes');
      const anonymous = interaction.options.getBoolean('anonymous') ?? false;
      const multiple = interaction.options.getBoolean('multiple') ?? false;
      const endsAt = minutes ? new Date(Date.now() + minutes * 60000) : null;

      const placeholder = await interaction.channel.send({ content: 'Creating poll…' });
      const result = await query(
        'INSERT INTO polls (guild_id, channel_id, message_id, creator_id, question, options, anonymous, multiple, ends_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
        [interaction.guildId, interaction.channelId, placeholder.id, interaction.user.id, question, JSON.stringify(options), anonymous, multiple, endsAt],
      );
      const row = result.rows[0];
      await placeholder.edit({ content: '', embeds: [pollEmbed(row, [])], components: pollButtons(row) });
      schedulePoll(interaction.client, row);
      await interaction.reply({ content: `✅ Poll #${row.id} created.`, ephemeral: true });
      return;
    }

    const id = interaction.options.getInteger('id');
    const result = await query('SELECT * FROM polls WHERE id = $1 AND guild_id = $2', [id, interaction.guildId]);
    const row = result.rows[0];
    if (!row) return interaction.reply({ content: '❌ Poll not found.', ephemeral: true });

    if (sub === 'close') {
      const closed = await closePoll(interaction.client, row.id);
      await interaction.reply({ content: closed ? `✅ Poll #${id} closed.` : 'ℹ️ That poll is already closed.', ephemeral: true });
      return;
    }

    const counts = await getCounts(row.id);
    const options = parseOptions(row);
    const total = counts.reduce((sum, n) => sum + n, 0);
    const lines = options.map((option, i) => `**${i + 1}. ${option}** — ${counts[i] || 0} vote${(counts[i] || 0) === 1 ? '' : 's'}`);
    await interaction.reply({ content: `📊 **Poll #${id}:** ${row.question}\\n\\n${lines.join('\\n')}\\n\\nTotal votes: **${total}**`, ephemeral: row.anonymous });
  },
};

module.exports = { command, handlePollButton, restorePolls };
