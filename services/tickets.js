const {
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const { query } = require('../database/database');
const { normalizeSettings } = require('../utils/config');

async function getSettings(guildId) {
  const result = await query('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId]);
  return normalizeSettings(result.rows[0]);
}

function ticketTopic(userId) {
  return `ticket-owner:${userId}`;
}

function isTicketChannel(channel) {
  return channel?.type === ChannelType.GuildText && typeof channel.topic === 'string' && channel.topic.startsWith('ticket-owner:');
}

function ownerIdFromChannel(channel) {
  return isTicketChannel(channel) ? channel.topic.slice('ticket-owner:'.length) : null;
}

function controlRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claim').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Close').setStyle(ButtonStyle.Danger),
  );
}

async function setupTicketPanel(interaction) {
  const settings = await getSettings(interaction.guildId);
  if (!settings.ticket_category_id) {
    return { ok: false, message: '❌ Configure a ticket category first with `/settings ticket-category`.' };
  }

  const category = interaction.guild.channels.cache.get(settings.ticket_category_id);
  if (!category || category.type !== ChannelType.GuildCategory) {
    return { ok: false, message: '❌ The configured ticket category no longer exists.' };
  }

  await interaction.reply({
    embeds: [new EmbedBuilder()
      .setTitle('🎫 Support Tickets')
      .setDescription('Need help? Click **Open Ticket** below. Your ticket will be private to you and the server staff.')],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_open').setLabel('Open Ticket').setStyle(ButtonStyle.Success),
    )],
  });
  return { ok: true };
}

async function findOpenTicket(guild, userId) {
  return guild.channels.cache.find(channel => isTicketChannel(channel) && ownerIdFromChannel(channel) === userId);
}

async function openTicket(interaction) {
  const settings = await getSettings(interaction.guildId);
  if (!settings.ticket_category_id) {
    await interaction.reply({ content: '❌ Tickets are not configured yet.', ephemeral: true });
    return true;
  }

  const existing = await findOpenTicket(interaction.guild, interaction.user.id);
  if (existing) {
    await interaction.reply({ content: `You already have an open ticket: ${existing}`, ephemeral: true });
    return true;
  }

  const category = interaction.guild.channels.cache.get(settings.ticket_category_id);
  if (!category || category.type !== ChannelType.GuildCategory) {
    await interaction.reply({ content: '❌ The configured ticket category is missing.', ephemeral: true });
    return true;
  }

  const channel = await interaction.guild.channels.create({
    name: `ticket-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 90),
    type: ChannelType.GuildText,
    parent: category.id,
    topic: ticketTopic(interaction.user.id),
    permissionOverwrites: [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
    ],
  });

  await channel.send({
    content: `<@${interaction.user.id}>`,
    embeds: [new EmbedBuilder()
      .setTitle('🎫 Ticket Opened')
      .setDescription('Tell the staff what you need help with. A staff member can claim this ticket when ready.')],
    components: [controlRow()],
  });
  await interaction.reply({ content: `✅ Your ticket is ready: ${channel}`, ephemeral: true });
  return true;
}

async function claimTicket(interaction) {
  if (!isTicketChannel(interaction.channel)) return false;
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({ content: '❌ You need Manage Channels to claim tickets.', ephemeral: true });
    return true;
  }
  await interaction.channel.setTopic(`${interaction.channel.topic}|claimed:${interaction.user.id}`).catch(() => null);
  await interaction.reply({ content: `🛠️ Ticket claimed by **${interaction.user.tag}**.` });
  return true;
}

async function closeTicket(interaction) {
  if (!isTicketChannel(interaction.channel)) return false;
  const ownerId = ownerIdFromChannel(interaction.channel);
  const canClose = interaction.user.id === ownerId || interaction.member.permissions.has(PermissionFlagsBits.ManageChannels);
  if (!canClose) {
    await interaction.reply({ content: '❌ Only the ticket owner or staff can close this ticket.', ephemeral: true });
    return true;
  }

  await interaction.channel.permissionOverwrites.edit(ownerId, { SendMessages: false }).catch(() => null);
  await interaction.channel.setName(`closed-${interaction.channel.name.replace(/^ticket-/, '').slice(0, 85)}`).catch(() => null);
  await interaction.reply({ content: '🔒 Ticket closed. Staff can delete the channel when finished.' });
  return true;
}

async function deleteTicket(interaction) {
  if (!isTicketChannel(interaction.channel)) return false;
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({ content: '❌ You need Manage Channels to delete tickets.', ephemeral: true });
    return true;
  }
  await interaction.reply({ content: '🗑️ Deleting ticket…' });
  setTimeout(() => interaction.channel.delete('Ticket deleted').catch(() => null), 750);
  return true;
}

async function handleTicketButton(interaction) {
  if (!interaction.isButton()) return false;
  if (interaction.customId === 'ticket_open') return openTicket(interaction);
  if (interaction.customId === 'ticket_claim') return claimTicket(interaction);
  if (interaction.customId === 'ticket_close') return closeTicket(interaction);
  if (interaction.customId === 'ticket_delete') return deleteTicket(interaction);
  return false;
}

module.exports = { setupTicketPanel, handleTicketButton, isTicketChannel };
