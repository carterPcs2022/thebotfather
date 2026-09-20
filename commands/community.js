const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { giveRep, getRep, repLeaderboard, claimDaily } = require('../services/community');

const rep = {
  data: new SlashCommandBuilder().setName('rep').setDescription('Give or view reputation.')
    .addSubcommand(s => s.setName('give').setDescription('Give +1 reputation to a member.')
      .addUserOption(o => o.setName('user').setDescription('Member to give reputation to.').setRequired(true)))
    .addSubcommand(s => s.setName('check').setDescription('View a member reputation.')
      .addUserOption(o => o.setName('user').setDescription('Member to inspect.'))),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser('user') || interaction.user;
    if (sub === 'check') return interaction.reply({ content: '⭐ **' + user.username + '** has **' + await getRep(interaction.guildId, user.id) + ' reputation**.' });
    try {
      const result = await giveRep(interaction.guildId, interaction.user.id, user.id);
      if (!result.ok) {
        const minutes = Math.ceil(result.remainingMs / 60000);
        return interaction.reply({ content: '⏳ You already gave **' + user.username + '** reputation recently. Try again in about **' + minutes + ' minutes**.', ephemeral: true });
      }
      return interaction.reply('⭐ ' + interaction.user + ' gave **' + user.username + '** +1 reputation! They now have **' + result.points + '**.');
    } catch (error) {
      if (error.message === 'SELF_REP') return interaction.reply({ content: '❌ You cannot give reputation to yourself.', ephemeral: true });
      throw error;
    }
  },
};

const daily = {
  data: new SlashCommandBuilder().setName('daily').setDescription('Claim your daily XP reward.'),
  async execute(interaction) {
    const result = await claimDaily(interaction.guildId, interaction.user.id);
    if (!result.ok) {
      const hours = Math.ceil(result.remainingMs / 3600000);
      return interaction.reply({ content: '⏳ Your daily reward is already claimed. Come back in about **' + hours + ' hour(s)**.', ephemeral: true });
    }
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🎁 Daily Reward Claimed!').setDescription('You received **' + result.xp + ' XP**.').addFields({ name: '🔥 Streak', value: String(result.streak), inline: true }, { name: '📦 Total Claims', value: String(result.totalClaims), inline: true })] });
  },
};

const repLeaderboardCommand = {
  data: new SlashCommandBuilder().setName('repleaderboard').setDescription('Show the server reputation leaderboard.'),
  async execute(interaction) {
    const rows = await repLeaderboard(interaction.guildId, 10);
    if (!rows.length) return interaction.reply('No reputation has been earned yet.');
    const lines = await Promise.all(rows.map(async (row, i) => {
      const member = await interaction.guild.members.fetch(row.user_id).catch(() => null);
      return '**' + (i + 1) + '.** ' + (member ? member.user : '<@' + row.user_id + '>') + ' — **' + row.points + ' rep**';
    }));
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('⭐ Reputation Leaderboard').setDescription(lines.join('\n'))] });
  },
};

module.exports = { rep, daily, repLeaderboardCommand };