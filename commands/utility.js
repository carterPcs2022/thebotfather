const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const commands = [
  {
    data: new SlashCommandBuilder().setName('ping').setDescription('Check the bot latency.'),
    async execute(interaction) {
      await interaction.reply(`Pong! ${interaction.client.ws.ping}ms`);
    },
  },
  {
    data: new SlashCommandBuilder().setName('help').setDescription('Show The Bot Father command categories.'),
    async execute(interaction) {
      const embed = new EmbedBuilder()
        .setTitle('The Bot Father')
        .setDescription('Your Discord server management toolkit.')
        .addFields(
          { name: 'Moderation', value: '`/ban` `/kick` `/timeout` `/untimeout` `/warn` `/warnings` `/clear`' },
          { name: 'Giveaways', value: '`/giveaway start` `/giveaway end` `/giveaway reroll`' },
          { name: 'Utility', value: '`/ping` `/help` `/serverinfo` `/userinfo` `/avatar`' },
        );
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('serverinfo').setDescription('Show information about this server.'),
    async execute(interaction) {
      const guild = interaction.guild;
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle(guild.name)
          .addFields(
            { name: 'Members', value: String(guild.memberCount), inline: true },
            { name: 'Channels', value: String(guild.channels.cache.size), inline: true },
            { name: 'Server ID', value: guild.id, inline: false },
          )],
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('userinfo')
      .setDescription('Show information about a user.')
      .addUserOption(option => option.setName('user').setDescription('The user to inspect.').setRequired(false)),
    async execute(interaction) {
      const user = interaction.options.getUser('user') || interaction.user;
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle(user.tag)
          .setThumbnail(user.displayAvatarURL({ size: 256 }))
          .addFields(
            { name: 'User ID', value: user.id },
            { name: 'Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>` },
          )],
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('avatar')
      .setDescription('Show a user avatar.')
      .addUserOption(option => option.setName('user').setDescription('The user.').setRequired(false)),
    async execute(interaction) {
      const user = interaction.options.getUser('user') || interaction.user;
      await interaction.reply(user.displayAvatarURL({ size: 1024, extension: 'png' }));
    },
  },
];

module.exports = commands;
