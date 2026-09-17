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

function giveawayRow(id, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway:enter:${id}`)
      .setLabel('Enter Giveaway')
      .setEmoji('🎉')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
  );
}

function giveawayEmbed(row) {
  return new EmbedBuilder()
    .setTitle('🎉 Giveaway')
    .setDescription(`**${row.prize}**\n\nClick the button below to enter.`)
    .addFields(
      { name: 'Winners', value: String(row.winners), inline: true },
      { name: 'Ends', value: `<t:${Math.floor(new Date(row.ends_at).getTime() / 1000)}:R>`, inline: true },
      { name: 'Entries', value: String(Array.isArray(row.entries) ? row.entries.length : 0), inline: true },
    )
    .setFooter({ text: `Hosted by ${row.host_id}` });
}

function pickWinners(entries, count, excluded = []) {
  const available = entries.filter(id => !excluded.includes(id));
  const shuffled = [...available];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}

async function finishGiveaway(client, id) {
  const result = await query('SELECT * FROM giveaways WHERE id = $1', [id]);
  const row = result.rows[0];
  if (!row || row.ended) return;

  const entries = Array.isArray(row.entries) ? row.entries : [];
  const winners = pickWinners(entries, row.winners);

  await query('UPDATE giveaways SET ended = TRUE, winner_ids = $1 WHERE id = $2', [JSON.stringify(winners), id]);
  timers.delete(String(id));

  const channel = await client.channels.fetch(row.channel_id).catch(() => null);
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(row.message_id).catch(() => null);

  if (message) {
    const updated = { ...row, ended: true, entries, winner_ids: winners };
    await message.edit({ embeds: [giveawayEmbed(updated)], components: [giveawayRow(id, true)] }).catch(() => null);
  }

  if (!winners.length) {
    await channel.send(`🎉 Giveaway ended for **${row.prize}**, but nobody entered.`);
    return;
  }

  await channel.send(`🎉 Giveaway ended! Congratulations ${winners.map(id => `<@${id}>`).join(', ')} — you won **${row.prize}**!`);
}

function scheduleGiveaway(client, row) {
  const delay = Math.max(0, new Date(row.ends_at).getTime() - Date.now());
  if (timers.has(String(row.id))) clearTimeout(timers.get(String(row.id)));
  const timer = setTimeout(() => finishGiveaway(client, row.id).catch(console.error), delay);
  timers.set(String(row.id), timer);
}

async function restoreGiveaways(client) {
  const result = await query('SELECT * FROM giveaways WHERE ended = FALSE ORDER BY ends_at ASC');
  for (const row of result.rows) scheduleGiveaway(client, row);
  console.log(`[Giveaways] Restored ${result.rows.length} active giveaway(s).`);
}

async function handleGiveawayButton(interaction) {
  if (!interaction.customId.startsWith('giveaway:enter:')) return false;
  const id = interaction.customId.split(':')[2];
  const result = await query('SELECT * FROM giveaways WHERE id = $1', [id]);
  const row = result.rows[0];
  if (!row || row.ended) {
    await interaction.reply({ content: 'This giveaway has ended.', ephemeral: true });
    return true;
  }
  if (new Date(row.ends_at).getTime() <= Date.now()) {
    await finishGiveaway(interaction.client, row.id);
    await interaction.reply({ content: 'This giveaway just ended.', ephemeral: true });
    return true;
  }

  const entries = Array.isArray(row.entries) ? row.entries : [];
  if (entries.includes(interaction.user.id)) {
    await interaction.reply({ content: 'You are already entered! 🎉', ephemeral: true });
    return true;
  }

  entries.push(interaction.user.id);
  await query('UPDATE giveaways SET entries = $1 WHERE id = $2', [JSON.stringify(entries), id]);
  await interaction.reply({ content: 'You are entered! Good luck! 🎉', ephemeral: true });
  return true;
}

const command = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Manage giveaways.')
    .addSubcommand(sub => sub
      .setName('start').setDescription('Start a giveaway.')
      .addIntegerOption(o => o.setName('minutes').setDescription('Duration in minutes.').setMinValue(1).setMaxValue(10080).setRequired(true))
      .addStringOption(o => o.setName('prize').setDescription('Giveaway prize.').setMaxLength(200).setRequired(true))
      .addIntegerOption(o => o.setName('winners').setDescription('Number of winners.').setMinValue(1).setMaxValue(20).setRequired(true)))
    .addSubcommand(sub => sub
      .setName('end').setDescription('End a giveaway early.')
      .addIntegerOption(o => o.setName('id').setDescription('Giveaway ID.').setMinValue(1).setRequired(true)))
    .addSubcommand(sub => sub
      .setName('reroll').setDescription('Reroll a giveaway winner.')
      .addIntegerOption(o => o.setName('id').setDescription('Giveaway ID.').setMinValue(1).setRequired(true))),
  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: '❌ You need Manage Server to manage giveaways.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    if (sub === 'start') {
      const minutes = interaction.options.getInteger('minutes');
      const prize = interaction.options.getString('prize');
      const winners = interaction.options.getInteger('winners');
      const endsAt = new Date(Date.now() + minutes * 60 * 1000);

      const message = await interaction.channel.send({ content: 'Creating giveaway…' });
      const result = await query(
        'INSERT INTO giveaways (guild_id, channel_id, message_id, host_id, prize, winners, ends_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [interaction.guildId, interaction.channelId, message.id, interaction.user.id, prize, winners, endsAt],
      );
      const row = result.rows[0];
      await message.edit({ content: '', embeds: [giveawayEmbed(row)], components: [giveawayRow(row.id)] });
      scheduleGiveaway(interaction.client, row);
      await interaction.reply({ content: `✅ Giveaway #${row.id} started!`, ephemeral: true });
      return;
    }

    const id = interaction.options.getInteger('id');
    const result = await query('SELECT * FROM giveaways WHERE id = $1 AND guild_id = $2', [id, interaction.guildId]);
    const row = result.rows[0];
    if (!row) return interaction.reply({ content: '❌ Giveaway not found.', ephemeral: true });

    if (sub === 'end') {
      await finishGiveaway(interaction.client, row.id);
      await interaction.reply({ content: `✅ Giveaway #${id} ended.`, ephemeral: true });
    } else {
      const entries = Array.isArray(row.entries) ? row.entries : [];
      const oldWinners = Array.isArray(row.winner_ids) ? row.winner_ids : [];
      const winners = pickWinners(entries, 1, oldWinners);
      if (!winners.length) return interaction.reply({ content: '❌ There are no eligible entries to reroll.', ephemeral: true });
      await query('UPDATE giveaways SET winner_ids = $1 WHERE id = $2', [JSON.stringify(winners), id]);
      await interaction.reply(`🎉 Giveaway #${id} rerolled! New winner: ${winners.map(w => `<@${w}>`).join(', ')}`);
    }
  },
};

module.exports = { command, handleGiveawayButton, restoreGiveaways };
