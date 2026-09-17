const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { verifyMember } = require('../services/server-automation');

const command = {
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Set up or complete server verification.')
    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Post the verification panel in this channel.'))
    .addSubcommand(sub => sub
      .setName('check')
      .setDescription('Complete verification.')),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'setup') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ You need Manage Server to set up verification.', ephemeral: true });
      }
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('verify_member')
          .setLabel('Verify')
          .setStyle(ButtonStyle.Success),
      );
      return interaction.reply({
        content: '🔐 **Server Verification**\nClick the button below to verify and receive the configured verified role.',
        components: [row],
      });
    }

    const result = await verifyMember(interaction);
    return interaction.reply({ content: result.message, ephemeral: true });
  },
};

async function handleVerificationButton(interaction) {
  if (!interaction.isButton() || interaction.customId !== 'verify_member') return false;
  try {
    const result = await verifyMember(interaction);
    await interaction.reply({ content: result.message, ephemeral: true });
  } catch (error) {
    console.error('[Verification]', error);
    await interaction.reply({ content: '❌ I could not complete verification. Check my role position and permissions.', ephemeral: true }).catch(() => null);
  }
  return true;
}

module.exports = { command, handleVerificationButton };
