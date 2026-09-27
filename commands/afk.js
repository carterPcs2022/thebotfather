const { SlashCommandBuilder } = require('discord.js');
const { query } = require('../database/database');

const command = {
  data: new SlashCommandBuilder()
    .setName('afk')
    .setDescription('Set your AFK status and an optional reason.')
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Why you are AFK.')
        .setMaxLength(500)
    ),

  async execute(interaction) {
    const reason = interaction.options.getString('reason')?.trim() || 'AFK';

    try {
      await query(
        `INSERT INTO afk_status (guild_id, user_id, reason, set_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (guild_id, user_id)
         DO UPDATE SET reason = EXCLUDED.reason, set_at = NOW()`,
        [interaction.guildId, interaction.user.id, reason]
      );

      await interaction.reply({
        content: `💤 ${interaction.user.displayName} is now AFK — ${reason}`,
      });
    } catch (error) {
      console.error('[AFK] Could not save AFK status:', error);
      await interaction.reply({
        content: '❌ I could not save your AFK status because the database is unavailable.',
        ephemeral: true,
      }).catch(() => null);
    }
  },
};

module.exports = { command };
