const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { setupTicketPanel } = require('../services/tickets');

const command = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Manage the server ticket system.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Post the ticket panel in this channel.')),

  async execute(interaction) {
    try {
      await setupTicketPanel(interaction);
    } catch (error) {
      console.error('[Tickets]', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Could not set up the ticket panel.', ephemeral: true }).catch(() => null);
      }
    }
  },
};

module.exports = { command };
