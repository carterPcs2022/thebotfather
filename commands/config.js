const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const { query } = require('../database/database');
const { DEFAULT_SETTINGS, normalizeSettings } = require('../utils/config');

async function getSettings(guildId) {
  const result = await query('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId]);
  if (result.rows[0]) return normalizeSettings(result.rows[0]);
  const columns = ['guild_id', ...Object.keys(DEFAULT_SETTINGS)];
  const values = [guildId, ...Object.values(DEFAULT_SETTINGS)];
  const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
  await query(
    `INSERT INTO guild_settings (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT (guild_id) DO NOTHING`,
    values,
  );
  return normalizeSettings((await query('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId])).rows[0]);
}

async function setSetting(guildId, key, value) {
  if (!(key in DEFAULT_SETTINGS)) throw new Error(`Unknown setting: ${key}`);
  const result = await query(
    `INSERT INTO guild_settings (guild_id, ${key}, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (guild_id) DO UPDATE SET ${key} = EXCLUDED.${key}, updated_at = NOW()
     RETURNING *`,
    [guildId, value],
  );
  return normalizeSettings(result.rows[0]);
}

function channelMention(id) {
  return id ? `<#${id}>` : 'Not configured';
}

const command = {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('View and configure The Bot Father for this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub => sub
      .setName('view')
      .setDescription('View the current server configuration.'))
    .addSubcommand(sub => sub
      .setName('log-channel')
      .setDescription('Set the moderation/event log channel.')
      .addChannelOption(o => o.setName('channel').setDescription('Log channel.').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(sub => sub
      .setName('welcome-channel')
      .setDescription('Set the welcome channel.')
      .addChannelOption(o => o.setName('channel').setDescription('Welcome channel.').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(sub => sub
      .setName('goodbye-channel')
      .setDescription('Set the goodbye channel.')
      .addChannelOption(o => o.setName('channel').setDescription('Goodbye channel.').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(sub => sub
      .setName('autorole')
      .setDescription('Set the role automatically assigned to new members.')
      .addRoleOption(o => o.setName('role').setDescription('Autorole.').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('automod')
      .setDescription('Enable or disable the future AutoMod system.')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable AutoMod.').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('levels')
      .setDescription('Enable or disable the future leveling system.')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable leveling.').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('suggestions')
      .setDescription('Set the suggestion channel.')
      .addChannelOption(o => o.setName('channel').setDescription('Suggestion channel.').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(sub => sub
      .setName('ticket-category')
      .setDescription('Set the category used for tickets.')
      .addChannelOption(o => o.setName('category').setDescription('Ticket category.').addChannelTypes(ChannelType.GuildCategory).setRequired(true))),

  async execute(interaction) {
    try {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'view') {
        const s = await getSettings(interaction.guildId);
        return interaction.reply({
          ephemeral: true,
          embeds: [{
            title: '⚙️ The Bot Father — Server Settings',
            fields: [
              { name: 'Logging', value: channelMention(s.log_channel_id), inline: true },
              { name: 'Welcome', value: `${s.welcome_enabled ? 'Enabled' : 'Disabled'}\n${channelMention(s.welcome_channel_id)}`, inline: true },
              { name: 'Goodbye', value: `${s.goodbye_enabled ? 'Enabled' : 'Disabled'}\n${channelMention(s.goodbye_channel_id)}`, inline: true },
              { name: 'Autorole', value: s.autorole_id ? `<@&${s.autorole_id}>` : 'Not configured', inline: true },
              { name: 'AutoMod', value: s.automod_enabled ? 'Enabled' : 'Disabled', inline: true },
              { name: 'Levels', value: s.level_enabled ? 'Enabled' : 'Disabled', inline: true },
              { name: 'Suggestions', value: channelMention(s.suggestion_channel_id), inline: true },
              { name: 'Tickets', value: s.ticket_category_id ? `<#${s.ticket_category_id}>` : 'Not configured', inline: true },
            ],
          }],
        });
      }

      const mapping = {
        'log-channel': ['log_channel_id', interaction.options.getChannel('channel').id],
        'welcome-channel': ['welcome_channel_id', interaction.options.getChannel('channel').id],
        'goodbye-channel': ['goodbye_channel_id', interaction.options.getChannel('channel').id],
        'autorole': ['autorole_id', interaction.options.getRole('role').id],
        'automod': ['automod_enabled', interaction.options.getBoolean('enabled')],
        'levels': ['level_enabled', interaction.options.getBoolean('enabled')],
        'suggestions': ['suggestion_channel_id', interaction.options.getChannel('channel').id],
        'ticket-category': ['ticket_category_id', interaction.options.getChannel('category').id],
      };
      const [key, value] = mapping[subcommand] || [];
      if (!key) return interaction.reply({ content: '❌ Unknown settings option.', ephemeral: true });

      await setSetting(interaction.guildId, key, value);
      const labels = {
        log_channel_id: 'log channel',
        welcome_channel_id: 'welcome channel',
        goodbye_channel_id: 'goodbye channel',
        autorole_id: 'autorole',
        automod_enabled: 'AutoMod',
        level_enabled: 'levels',
        suggestion_channel_id: 'suggestion channel',
        ticket_category_id: 'ticket category',
      };
      return interaction.reply({ content: `✅ ${labels[key]} updated.`, ephemeral: true });
    } catch (error) {
      console.error('[Settings]', error);
      return interaction.reply({ content: '❌ Could not save that setting. Make sure PostgreSQL is configured.', ephemeral: true }).catch(() => null);
    }
  },
};

module.exports = { command, getSettings, setSetting };
