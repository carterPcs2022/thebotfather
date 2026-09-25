const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder } = require('discord.js');
const { query } = require('../database/database');

function buildMenu(panelId, roles) {
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId('rolepanel:' + panelId)
    .setPlaceholder('Choose your roles...')
    .setMinValues(0)
    .setMaxValues(Math.min(roles.length, 25))
    .addOptions(roles.map(id => ({ label: 'Role ' + id.slice(-6), value: id }))));
}

const command = {
  data: new SlashCommandBuilder().setName('rolepanel').setDescription('Create and manage self-assignable role panels.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(sub => sub.setName('create').setDescription('Create a role-selection panel.')
      .addChannelOption(o => o.setName('channel').setDescription('Panel channel.').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addRoleOption(o => o.setName('role1').setDescription('First selectable role.').setRequired(true))
      .addRoleOption(o => o.setName('role2').setDescription('Second selectable role.'))
      .addRoleOption(o => o.setName('role3').setDescription('Third selectable role.'))
      .addRoleOption(o => o.setName('role4').setDescription('Fourth selectable role.'))
      .addRoleOption(o => o.setName('role5').setDescription('Fifth selectable role.'))
      .addStringOption(o => o.setName('title').setDescription('Panel title.').setMaxLength(100))
      .addStringOption(o => o.setName('description').setDescription('Panel description.').setMaxLength(1000)))
    .addSubcommand(sub => sub.setName('delete').setDescription('Delete a role panel.')
      .addIntegerOption(o => o.setName('id').setDescription('Panel ID.').setMinValue(1).setRequired(true)))
    .addSubcommand(sub => sub.setName('list').setDescription('List role panels.')),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    try {
      const sub = interaction.options.getSubcommand();
      if (sub === 'create') {
        const channel = interaction.options.getChannel('channel');
        const roles = ['role1','role2','role3','role4','role5'].map(name => interaction.options.getRole(name)).filter(Boolean);
        const unique = [...new Map(roles.map(role => [role.id, role])).values()];
        if (!unique.length) return interaction.editReply('❌ At least one role is required.');
        if (unique.some(role => !role.editable)) return interaction.editReply('❌ I cannot manage one or more selected roles. Move those roles below The Bot Father role.');
        const title = interaction.options.getString('title') || 'Choose your roles';
        const description = interaction.options.getString('description') || 'Select the roles you want.';
        const insert = await query('INSERT INTO role_panels (guild_id, channel_id, creator_id, title, description, role_ids) VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING id', [interaction.guildId, channel.id, interaction.user.id, title, description, JSON.stringify(unique.map(role => role.id))]);
        const panelId = insert.rows[0].id;
        const message = await channel.send({ embeds: [new EmbedBuilder().setTitle(title).setDescription(description)], components: [buildMenu(panelId, unique)] });
        await query('UPDATE role_panels SET message_id = $2 WHERE id = $1', [panelId, message.id]);
        return interaction.editReply('✅ Role panel **#' + panelId + '** created in ' + channel + '.');
      }
      if (sub === 'list') {
        const result = await query('SELECT id, channel_id, message_id, title, role_ids FROM role_panels WHERE guild_id = $1 ORDER BY id DESC LIMIT 25', [interaction.guildId]);
        if (!result.rows.length) return interaction.editReply('No role panels configured.');
        return interaction.editReply(result.rows.map(row => '**#' + row.id + '** • <#' + row.channel_id + '> • ' + row.title + ' • ' + row.role_ids.length + ' role(s)').join('\n'));
      }
      const id = interaction.options.getInteger('id', true);
      const result = await query('DELETE FROM role_panels WHERE guild_id = $1 AND id = $2 RETURNING id, channel_id, message_id', [interaction.guildId, id]);
      if (!result.rowCount) return interaction.editReply('❌ Role panel **#' + id + '** was not found.');
      const row = result.rows[0];
      const channel = await interaction.guild.channels.fetch(row.channel_id).catch(() => null);
      if (channel?.isTextBased()) await channel.messages.delete(row.message_id).catch(() => null);
      return interaction.editReply('🗑️ Role panel **#' + id + '** deleted.');
    } catch (error) {
      console.error('[RolePanel]', error);
      return interaction.editReply('❌ Could not manage role panels. Make sure PostgreSQL is configured and the bot can manage the selected roles.');
    }
  },
};

async function handleRolePanel(interaction) {
  if (!interaction.isStringSelectMenu() || !interaction.customId.startsWith('rolepanel:')) return false;
  await interaction.deferReply({ ephemeral: true });
  const panelId = interaction.customId.split(':')[1];
  try {
    const result = await query('SELECT guild_id, role_ids FROM role_panels WHERE id = $1 AND message_id = $2', [panelId, interaction.message.id]);
    const panel = result.rows[0];
    if (!panel || panel.guild_id !== interaction.guildId) {
      await interaction.editReply('❌ This role panel is no longer active.');
      return true;
    }
    const panelRoles = Array.isArray(panel.role_ids) ? panel.role_ids : [];
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const selected = new Set(interaction.values);
    for (const roleId of panelRoles) {
      if (selected.has(roleId)) await member.roles.add(roleId).catch(() => null);
      else if (member.roles.cache.has(roleId)) await member.roles.remove(roleId).catch(() => null);
    }
    const names = panelRoles.map(id => interaction.guild.roles.cache.get(id)?.name).filter(Boolean).filter(name => interaction.values.some(id => interaction.guild.roles.cache.get(id)?.name === name));
    await interaction.editReply(names.length ? '✅ Your selected roles: ' + names.join(', ') : '✅ Your role-panel roles have been cleared.');
    return true;
  } catch (error) {
    console.error('[RolePanel] Interaction failed:', error);
    await interaction.editReply('❌ I could not update your roles.').catch(() => null);
    return true;
  }
}

module.exports = { command, handleRolePanel };
