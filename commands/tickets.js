const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { setupTicketPanel, executeTicketAction } = require('../services/tickets');

const command = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Manage the server ticket system.')
    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Post the ticket panel in this channel.'))
    .addSubcommand(sub => sub
      .setName('close')
      .setDescription('Close the current ticket.'))
    .addSubcommand(sub => sub
      .setName('reopen')
      .setDescription('Reopen the current ticket.'))
    .addSubcommand(sub => sub
      .setName('delete')
      .setDescription('Delete the current ticket and save a transcript if configured.')),

  async execute(interaction) {
    try {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'setup') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
          return interaction.reply({ content: '❌ You need Manage Channels to set up the ticket panel.', ephemeral: true });
        }
        const result = await setupTicketPanel(interaction);
        if (!result.ok) await interaction.reply({ content: result.message, ephemeral: true });
        return;
      }
      await executeTicketAction(interaction, subcommand);
    } catch (error) {
      console.error('[Tickets]', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Could not complete that ticket action.', ephemeral: true }).catch(() => null);
      }
    }
  },
};

module.exports = { command };
