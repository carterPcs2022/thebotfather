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
const MAX_DURATION_MINUTES = 10080;
const MAX_BONUS_ENTRIES = 20;

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
  const requirements = [];
  if (row.required_role_id) requirements.push(`Required role: <@&${row.required_role_id}>`);
  if (row.excluded_role_id) requirements.push(`Excluded role: <@&${row.excluded_role_id}>`);
  if (row.min_account_age_days > 0) requirements.push(`Account age: ${row.min_account_age_days}+ days`);
  if (row.min_server_age_days > 0) requirements.push(`Server membership: ${row.min_server_age_days}+ days`);
  if (row.bonus_entries > 0) requirements.push(`Bonus entries: +${row.bonus_entries}`);

  const embed = new EmbedBuilder()
    .setTitle('🎉 Giveaway')
    .setDescription(`**${row.prize}**\\n\\nClick the button below to enter.`)
    .addFields(
      { name: 'Winners', value: String(row.winners), inline: true },
      { name: 'Ends', value: `<t:${Math.floor(new Date(row.ends_at).getTime() / 1000)}:R>`, inline: true },
      { name: 'Entries', value: String(Array.isArray(row.entries) ? row.entries.length : 0), inline: true },
    )
    .setFooter({ text: `Hosted by ${row.host_id}` });

  if (requirements.length) embed.addFields({ name: 'Requirements', value: requirements.join('\\n') });
  return embed;
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

function parseEntries(row) {
  if (!Array.isArray(row.entries)) return [];
  return row.entries.filter(entry => typeof entry === 'string');
}

function userEligible(member, row) {
  if (!member) return { ok: false, reason: 'You must be a member of this server.' };
  if (row.required_role_id && !member.roles.cache.has(row.required_role_id)) {
    return { ok: false, reason: `You need the required role <@&${row.required_role_id}>.` };
  }
  if (row.excluded_role_id && member.roles.cache.has(row.excluded_role_id)) {
    return { ok: false, reason: 'Your current roles make you ineligible for this giveaway.' };
  }

  const accountAgeDays = (Date.now() - member.user.createdTimestamp) / 86400000;
  if (accountAgeDays < Number(row.min_account_age_days || 0)) {
    return { ok: false, reason: `Your Discord account must be at least ${row.min_account_age_days} days old.` };
  }

  const joinedTimestamp = member.joinedTimestamp;
  if (!joinedTimestamp || (Date.now() - joinedTimestamp) / 86400000 < Number(row.min_server_age_days || 0)) {
    return { ok: false, reason: `You must have been in this server for at least ${row.min_server_age_days} days.` };
  }

  return { ok: true };
}

function weightedPool(entries, row) {
  const pool = [];
  for (const userId of entries) {
    pool.push(userId);
    const bonus = Math.min(MAX_BONUS_ENTRIES, Math.max(0, Number(row.bonus_entries || 0)));
    for (let i = 0; i < bonus; i += 1) pool.push(userId);
  }
  return pool;
}

function pickWeightedWinners(entries, count, row, excluded = []) {
  const pool = weightedPool(entries.filter(id => !excluded.includes(id)), row);
  const winners = [];
  while (pool.length && winners.length < count) {
    const index = Math.floor(Math.random() * pool.length);
    const winner = pool[index];
    winners.push(winner);
    for (let i = pool.length - 1; i >= 0; i -= 1) {
      if (pool[i] === winner) pool.splice(i, 1);
    }
  }
  return winners;
}

async function finishGiveaway(client, id) {
  const result = await query('SELECT * FROM giveaways WHERE id = $1', [id]);
  const row = result.rows[0];
  if (!row || row.ended) return;

  const entries = parseEntries(row);
  const winners = pickWeightedWinners(entries, row.winners, row);

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
  if (row.guild_id) {
    const logResult = await query('SELECT log_channel_id FROM guild_settings WHERE guild_id = $1', [row.guild_id]).catch(() => null);
    const logChannel = logResult?.rows?.[0]?.log_channel_id ? await client.channels.fetch(logResult.rows[0].log_channel_id).catch(() => null) : null;
    if (logChannel?.isTextBased()) {
      await logChannel.send(`🎉 Giveaway #${id} ended. Prize: **${row.prize}**. Winners: ${winners.map(id => `<@${id}>`).join(', ')}`).catch(() => null);
    }
  }
}

function scheduleGiveaway(client, row) {
  const delay = Math.max(0, new Date(row.ends_at).getTime() - Date.now());
  if (timers.has(String(row.id))) clearTimeout(timers.get(String(row.id)));
  const timer = setTimeout(() => finishGiveaway(client, row.id).catch(console.error), delay);
  timers.set(String(row.id), timer);
}

async function restoreGiveaways(client) {
  const result = await query('SELECT * FROM giveaways WHERE ended = FALSE ORDER BY ends_at ASC');
  for (const row of result.rows) {
    if (new Date(row.ends_at).getTime() <= Date.now()) {
      await finishGiveaway(client, row.id);
    } else {
      scheduleGiveaway(client, row);
    }
  }
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

  const member = interaction.member;
  const eligibility = userEligible(member, row);
  if (!eligibility.ok) {
    await interaction.reply({ content: `❌ ${eligibility.reason}`, ephemeral: true });
    return true;
  }

  const entries = parseEntries(row);
  if (entries.includes(interaction.user.id)) {
    await interaction.reply({ content: 'You are already entered! 🎉', ephemeral: true });
    return true;
  }

  entries.push(interaction.user.id);
  await query('UPDATE giveaways SET entries = $1 WHERE id = $2', [JSON.stringify(entries), id]);
  await interaction.reply({ content: `You are entered! Good luck! 🎉${row.bonus_entries ? ` You have ${row.bonus_entries} bonus entries.` : ''}`, ephemeral: true });
  return true;
}

const command = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Manage giveaways.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub => sub
      .setName('start').setDescription('Start a giveaway.')
      .addIntegerOption(o => o.setName('minutes').setDescription('Duration in minutes.').setMinValue(1).setMaxValue(MAX_DURATION_MINUTES).setRequired(true))
      .addStringOption(o => o.setName('prize').setDescription('Giveaway prize.').setMaxLength(200).setRequired(true))
      .addIntegerOption(o => o.setName('winners').setDescription('Number of winners.').setMinValue(1).setMaxValue(20).setRequired(true))
      .addRoleOption(o => o.setName('required-role').setDescription('Only members with this role may enter.').setRequired(false))
      .addRoleOption(o => o.setName('excluded-role').setDescription('Members with this role cannot enter.').setRequired(false))
      .addIntegerOption(o => o.setName('min-account-age').setDescription('Minimum Discord account age in days.').setMinValue(0).setMaxValue(3650).setRequired(false))
      .addIntegerOption(o => o.setName('min-server-age').setDescription('Minimum server membership in days.').setMinValue(0).setMaxValue(3650).setRequired(false))
      .addIntegerOption(o => o.setName('bonus-entries').setDescription('Extra weighted entries for eligible members.').setMinValue(0).setMaxValue(MAX_BONUS_ENTRIES).setRequired(false)))
    .addSubcommand(sub => sub
      .setName('end').setDescription('End a giveaway early.')
      .addIntegerOption(o => o.setName('id').setDescription('Giveaway ID.').setMinValue(1).setRequired(true)))
    .addSubcommand(sub => sub
      .setName('reroll').setDescription('Reroll a giveaway winner.')
      .addIntegerOption(o => o.setName('id').setDescription('Giveaway ID.').setMinValue(1).setRequired(true))),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'start') {
      const minutes = interaction.options.getInteger('minutes');
      const prize = interaction.options.getString('prize');
      const winners = interaction.options.getInteger('winners');
      const requiredRole = interaction.options.getRole('required-role');
      const excludedRole = interaction.options.getRole('excluded-role');
      const minAccountAge = interaction.options.getInteger('min-account-age') ?? 0;
      const minServerAge = interaction.options.getInteger('min-server-age') ?? 0;
      const bonusEntries = interaction.options.getInteger('bonus-entries') ?? 0;

      if (requiredRole && excludedRole && requiredRole.id === excludedRole.id) {
        return interaction.reply({ content: '❌ Required and excluded roles cannot be the same.', ephemeral: true });
      }

      const botMember = interaction.guild.members.me;
      if (requiredRole && botMember && requiredRole.position >= botMember.roles.highest.position) {
        return interaction.reply({ content: '❌ The required role must be below the bot role.', ephemeral: true });
      }
      if (excludedRole && botMember && excludedRole.position >= botMember.roles.highest.position) {
        return interaction.reply({ content: '❌ The excluded role must be below the bot role.', ephemeral: true });
      }

      const endsAt = new Date(Date.now() + minutes * 60 * 1000);
      const message = await interaction.channel.send({ content: 'Creating giveaway…' });
      const result = await query(
        `INSERT INTO giveaways
          (guild_id, channel_id, message_id, host_id, prize, winners, ends_at, required_role_id, excluded_role_id, min_account_age_days, min_server_age_days, bonus_entries)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [interaction.guildId, interaction.channelId, message.id, interaction.user.id, prize, winners, endsAt, requiredRole?.id || null, excludedRole?.id || null, minAccountAge, minServerAge, bonusEntries],
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
      return;
    }

    const entries = parseEntries(row);
    const oldWinners = Array.isArray(row.winner_ids) ? row.winner_ids : [];
    const winners = pickWeightedWinners(entries, 1, row, oldWinners);
    if (!winners.length) return interaction.reply({ content: '❌ There are no eligible entries to reroll.', ephemeral: true });

    await query('UPDATE giveaways SET winner_ids = $1 WHERE id = $2', [JSON.stringify(winners), id]);
    await interaction.reply(`🎉 Giveaway #${id} rerolled! New winner: ${winners.map(w => `<@${w}>`).join(', ')}`);
  },
};

module.exports = { command, handleGiveawayButton, restoreGiveaways };
