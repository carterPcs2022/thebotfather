const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { rank, leaderboard, xpForLevel } = require('../services/levels');

const command = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('View your XP and level.')
    .addUserOption(o => o.setName('user').setDescription('Member to inspect.')),
  async execute(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;
    const row = await rank(interaction.guildId, user.id);
    const xp = Number(row.xp);
    const level = Number(row.level);
    const next = xpForLevel(level + 1);
    const embed = new EmbedBuilder()
      .setTitle(`🏆 ${user.username}'s Rank`)
      .setThumbnail(user.displayAvatarURL())
      .addFields(
        { name: 'Level', value: String(level), inline: true },
        { name: 'XP', value: `${xp} / ${next}`, inline: true },
        { name: 'Messages', value: String(row.message_count), inline: true },
      );
    await interaction.reply({ embeds: [embed] });
  },
};

const leaderboardCommand = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the server XP leaderboard.'),
  async execute(interaction) {
    const rows = await leaderboard(interaction.guildId, 10);
    if (!rows.length) return interaction.reply('No XP has been earned yet.');
    const lines = await Promise.all(rows.map(async (row, i) => {
      const member = await interaction.guild.members.fetch(row.user_id).catch(() => null);
      return `**${i + 1}.** ${member ? member.user : `<@${row.user_id}>`} — Level **${row.level}**, **${row.xp} XP**`;
    }));
    const embed = new EmbedBuilder().setTitle('🏆 Server Leaderboard').setDescription(lines.join('\n'));
    await interaction.reply({ embeds: [embed] });
  },
};

module.exports = { command, leaderboardCommand };
