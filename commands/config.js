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

function channelMention(id) { return id ? `<#${id}>` : 'Not configured'; }
function roleMention(id) { return id ? `<@&${id}>` : 'Not configured'; }

const command = {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('View and configure The Bot Father for this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub => sub.setName('view').setDescription('View the current server configuration.'))
    .addSubcommand(sub => sub.setName('log-channel').setDescription('Set the moderation/event log channel.')
      .addChannelOption(o => o.setName('channel').setDescription('Log channel.').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(sub => sub.setName('welcome-channel').setDescription('Set the welcome channel.')
      .addChannelOption(o => o.setName('channel').setDescription('Welcome channel.').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(sub => sub.setName('welcome').setDescription('Enable or disable welcome messages.')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable welcome messages.').setRequired(true)))
    .addSubcommand(sub => sub.setName('welcome-dm').setDescription('Enable or disable welcome DMs.')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable welcome DMs.').setRequired(true)))
    .addSubcommand(sub => sub.setName('goodbye-channel').setDescription('Set the goodbye channel.')
      .addChannelOption(o => o.setName('channel').setDescription('Goodbye channel.').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(sub => sub.setName('goodbye').setDescription('Enable or disable goodbye messages.')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable goodbye messages.').setRequired(true)))
    .addSubcommand(sub => sub.setName('autorole').setDescription('Set the role automatically assigned to new members.')
      .addRoleOption(o => o.setName('role').setDescription('Autorole.').setRequired(true)))
    .addSubcommand(sub => sub.setName('verification').setDescription('Enable or disable button-based verification.')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable verification.').setRequired(true)))
    .addSubcommand(sub => sub.setName('verification-role').setDescription('Set the role given after verification.')
      .addRoleOption(o => o.setName('role').setDescription('Verified role.').setRequired(true)))
    .addSubcommand(sub => sub.setName('automod').setDescription('Enable or disable AutoMod.')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable AutoMod.').setRequired(true)))
    .addSubcommand(sub => sub.setName('automod-spam').setDescription('Enable or disable spam detection.')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable spam detection.').setRequired(true)))
    .addSubcommand(sub => sub.setName('automod-duplicates').setDescription('Enable or disable duplicate-message detection.')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable duplicate detection.').setRequired(true)))
    .addSubcommand(sub => sub.setName('automod-mentions').setDescription('Enable or disable mention protection.')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable mention protection.').setRequired(true)))
    .addSubcommand(sub => sub.setName('automod-links').setDescription('Enable or disable link/invite filtering.')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable link filtering.').setRequired(true)))
    .addSubcommand(sub => sub.setName('automod-caps').setDescription('Enable or disable excessive-caps detection.')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable caps detection.').setRequired(true)))
    .addSubcommand(sub => sub.setName('automod-emoji').setDescription('Enable or disable excessive-emoji detection.')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable emoji detection.').setRequired(true)))
    .addSubcommand(sub => sub.setName('automod-bad-words').setDescription('Enable or disable the configured bad-word filter.')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable the bad-word filter.').setRequired(true)))
    .addSubcommand(sub => sub.setName('automod-action').setDescription('Choose what AutoMod does when it detects a violation.')
      .addStringOption(o => o.setName('action').setDescription('Action to take.').setRequired(true)
        .addChoices({ name: 'Warn', value: 'warn' }, { name: 'Timeout', value: 'timeout' }, { name: 'Delete', value: 'delete' })))
    .addSubcommand(sub => sub.setName('levels').setDescription('Enable or disable the leveling system.')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable leveling.').setRequired(true)))
    .addSubcommand(sub => sub.setName('suggestions').setDescription('Set the suggestion channel.')
      .addChannelOption(o => o.setName('channel').setDescription('Suggestion channel.').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(sub => sub.setName('ticket-category').setDescription('Set the category used for tickets.')
      .addChannelOption(o => o.setName('category').setDescription('Ticket category.').addChannelTypes(ChannelType.GuildCategory).setRequired(true)))
    .addSubcommand(sub => sub.setName('ticket-staff-role').setDescription('Set the role that can access ticket channels.')
      .addRoleOption(o => o.setName('role').setDescription('Ticket staff role.').setRequired(true))),

  async execute(interaction) {
    try {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'view') {
        const s = await getSettings(interaction.guildId);
        return interaction.reply({ ephemeral: true, embeds: [{ title: '⚙️ The Bot Father — Server Settings', fields: [
          { name: 'Logging', value: channelMention(s.log_channel_id), inline: true },
          { name: 'Welcome', value: `${s.welcome_enabled ? 'Enabled' : 'Disabled'}\n${channelMention(s.welcome_channel_id)}`, inline: true },
          { name: 'Welcome DM', value: s.welcome_dm_enabled ? 'Enabled' : 'Disabled', inline: true },
          { name: 'Goodbye', value: `${s.goodbye_enabled ? 'Enabled' : 'Disabled'}\n${channelMention(s.goodbye_channel_id)}`, inline: true },
          { name: 'Autorole', value: s.autorole_id ? `<@&${s.autorole_id}>` : 'Not configured', inline: true },
          { name: 'Verification', value: `${s.verification_enabled ? 'Enabled' : 'Disabled'}\n${roleMention(s.verification_role_id)}`, inline: true },
          { name: 'AutoMod', value: s.automod_enabled ? 'Enabled' : 'Disabled', inline: true },
          { name: 'Levels', value: s.level_enabled ? 'Enabled' : 'Disabled', inline: true },
          { name: 'Suggestions', value: channelMention(s.suggestion_channel_id), inline: true },
          { name: 'Tickets', value: `${s.ticket_category_id ? `<#${s.ticket_category_id}>` : 'No category'}\nStaff: ${roleMention(s.ticket_staff_role_id)}`, inline: true },
        ] }] });
      }

      const mapping = {
        'log-channel': ['log_channel_id', interaction.options.getChannel('channel').id],
        'welcome-channel': ['welcome_channel_id', interaction.options.getChannel('channel').id],
        'welcome': ['welcome_enabled', interaction.options.getBoolean('enabled')],
        'welcome-dm': ['welcome_dm_enabled', interaction.options.getBoolean('enabled')],
        'goodbye-channel': ['goodbye_channel_id', interaction.options.getChannel('channel').id],
        'goodbye': ['goodbye_enabled', interaction.options.getBoolean('enabled')],
        'autorole': ['autorole_id', interaction.options.getRole('role').id],
        'verification': ['verification_enabled', interaction.options.getBoolean('enabled')],
        'verification-role': ['verification_role_id', interaction.options.getRole('role').id],
        'automod': ['automod_enabled', interaction.options.getBoolean('enabled')],
        'automod-spam': ['automod_spam_enabled', interaction.options.getBoolean('enabled')],
        'automod-duplicates': ['automod_duplicate_enabled', interaction.options.getBoolean('enabled')],
        'automod-mentions': ['automod_mention_enabled', interaction.options.getBoolean('enabled')],
        'automod-links': ['automod_link_enabled', interaction.options.getBoolean('enabled')],
        'automod-caps': ['automod_caps_enabled', interaction.options.getBoolean('enabled')],
        'automod-emoji': ['automod_emoji_enabled', interaction.options.getBoolean('enabled')],
        'automod-bad-words': ['automod_bad_words_enabled', interaction.options.getBoolean('enabled')],
        'automod-action': ['automod_action', interaction.options.getString('action')],
        'levels': ['level_enabled', interaction.options.getBoolean('enabled')],
        'suggestions': ['suggestion_channel_id', interaction.options.getChannel('channel').id],
        'ticket-category': ['ticket_category_id', interaction.options.getChannel('category').id],
        'ticket-staff-role': ['ticket_staff_role_id', interaction.options.getRole('role').id],
      };
      const [key, value] = mapping[subcommand] || [];
      if (!key) return interaction.reply({ content: '❌ Unknown settings option.', ephemeral: true });
      await setSetting(interaction.guildId, key, value);
      return interaction.reply({ content: `✅ **${key}** updated.`, ephemeral: true });
    } catch (error) {
      console.error('[Settings]', error);
      return interaction.reply({ content: '❌ Could not save that setting. Make sure PostgreSQL is configured.', ephemeral: true }).catch(() => null);
    }
  },
};

module.exports = { command, getSettings, setSetting };
