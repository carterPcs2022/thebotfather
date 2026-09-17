const {
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  AttachmentBuilder,
} = require('discord.js');
const { query } = require('../database/database');
const { normalizeSettings } = require('../utils/config');

const OWNER_PREFIX = 'ticket-owner:';
const CLAIM_PREFIX = 'claimed:';
const MAX_TRANSCRIPT_MESSAGES = 1000;

async function getSettings(guildId) {
  const result = await query('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId]);
  return normalizeSettings(result.rows[0]);
}

function ticketTopic(userId, claimedBy = null) {
  return `${OWNER_PREFIX}${userId}${claimedBy ? `|${CLAIM_PREFIX}${claimedBy}` : ''}`;
}

function parseTicketTopic(channel) {
  if (channel?.type !== ChannelType.GuildText || typeof channel.topic !== 'string') return null;
  if (!channel.topic.startsWith(OWNER_PREFIX)) return null;

  const parts = channel.topic.slice(OWNER_PREFIX.length).split('|');
  const ownerId = parts[0] || null;
  const claimedPart = parts.find(part => part.startsWith(CLAIM_PREFIX));
  const claimedBy = claimedPart ? claimedPart.slice(CLAIM_PREFIX.length) : null;

  return ownerId ? { ownerId, claimedBy } : null;
}

function isTicketChannel(channel) {
  return Boolean(parseTicketTopic(channel));
}

function ownerIdFromChannel(channel) {
  return parseTicketTopic(channel)?.ownerId || null;
}

function isClosedTicket(channel) {
  return channel?.name?.startsWith('closed-');
}

function openControlRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claim').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Close').setStyle(ButtonStyle.Danger),
  );
}

function closedControlRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_reopen').setLabel('Reopen').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ticket_delete').setLabel('Delete').setStyle(ButtonStyle.Danger),
  );
}

async function upsertTicket(guildId, channelId, ownerId) {
  await query(`
    INSERT INTO tickets (guild_id, channel_id, owner_id, status)
    VALUES ($1, $2, $3, 'open')
    ON CONFLICT (channel_id) DO UPDATE
      SET owner_id = EXCLUDED.owner_id,
          status = 'open',
          closed_at = NULL
  `, [guildId, channelId, ownerId]);
}

async function markClaimed(channelId, staffId) {
  await query('UPDATE tickets SET claimed_by = $1 WHERE channel_id = $2', [staffId, channelId]);
}

async function markClosed(channelId) {
  await query("UPDATE tickets SET status = 'closed', closed_at = NOW() WHERE channel_id = $1", [channelId]);
}

async function markReopened(channelId) {
  await query("UPDATE tickets SET status = 'open', closed_at = NULL WHERE channel_id = $1", [channelId]);
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
  const cached = guild.channels.cache.find(channel => {
    const data = parseTicketTopic(channel);
    return data?.ownerId === userId && !isClosedTicket(channel);
  });
  if (cached) return cached;

  try {
    const result = await query(
      "SELECT channel_id FROM tickets WHERE guild_id = $1 AND owner_id = $2 AND status = 'open' ORDER BY created_at DESC LIMIT 1",
      [guild.id, userId],
    );
    return result.rows[0] ? guild.channels.cache.get(result.rows[0].channel_id) || null : null;
  } catch {
    return null;
  }
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

  const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'user';
  const channel = await interaction.guild.channels.create({
    name: `ticket-${safeName}`.slice(0, 100),
    type: ChannelType.GuildText,
    parent: category.id,
    topic: ticketTopic(interaction.user.id),
    permissionOverwrites: [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
    ],
  });

  try {
    await upsertTicket(interaction.guildId, channel.id, interaction.user.id);
  } catch (error) {
    console.error('[Tickets] Failed to persist new ticket:', error);
  }

  await channel.send({
    content: `<@${interaction.user.id}>`,
    embeds: [new EmbedBuilder()
      .setTitle('🎫 Ticket Opened')
      .setDescription('Tell the staff what you need help with. A staff member can claim this ticket when ready.')],
    components: [openControlRow()],
  });
  await interaction.reply({ content: `✅ Your ticket is ready: ${channel}`, ephemeral: true });
  return true;
}

async function claimTicket(interaction) {
  if (!isTicketChannel(interaction.channel)) return false;
  if (isClosedTicket(interaction.channel)) {
    await interaction.reply({ content: '❌ Reopen the ticket before claiming it.', ephemeral: true });
    return true;
  }
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({ content: '❌ You need Manage Channels to claim tickets.', ephemeral: true });
    return true;
  }

  const ticket = parseTicketTopic(interaction.channel);
  await interaction.channel.setTopic(ticketTopic(ticket.ownerId, interaction.user.id)).catch(() => null);
  await markClaimed(interaction.channel.id, interaction.user.id).catch(error => console.error('[Tickets] Failed to persist claim:', error));
  await interaction.reply({ content: `🛠️ Ticket claimed by **${interaction.user.tag}**.` });
  return true;
}

async function closeTicket(interaction) {
  if (!isTicketChannel(interaction.channel)) return false;
  if (isClosedTicket(interaction.channel)) {
    await interaction.reply({ content: 'ℹ️ This ticket is already closed.', ephemeral: true });
    return true;
  }

  const ownerId = ownerIdFromChannel(interaction.channel);
  const canClose = interaction.user.id === ownerId || interaction.member.permissions.has(PermissionFlagsBits.ManageChannels);
  if (!canClose) {
    await interaction.reply({ content: '❌ Only the ticket owner or staff can close this ticket.', ephemeral: true });
    return true;
  }

  await interaction.channel.permissionOverwrites.edit(ownerId, { SendMessages: false }).catch(() => null);
  await interaction.channel.setName(`closed-${interaction.channel.name.replace(/^ticket-/, '').slice(0, 93)}`).catch(() => null);
  await markClosed(interaction.channel.id).catch(error => console.error('[Tickets] Failed to persist close:', error));
  await interaction.reply({
    content: '🔒 Ticket closed. Staff can reopen it or delete it when finished.',
    components: [closedControlRow()],
  });
  return true;
}

async function reopenTicket(interaction) {
  if (!isTicketChannel(interaction.channel)) return false;
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({ content: '❌ You need Manage Channels to reopen tickets.', ephemeral: true });
    return true;
  }

  const ownerId = ownerIdFromChannel(interaction.channel);
  await interaction.channel.permissionOverwrites.edit(ownerId, { SendMessages: true }).catch(() => null);
  await interaction.channel.setName(`ticket-${interaction.channel.name.replace(/^closed-/, '').slice(0, 93)}`).catch(() => null);
  await markReopened(interaction.channel.id).catch(error => console.error('[Tickets] Failed to persist reopen:', error));
  await interaction.reply({
    content: '🔓 Ticket reopened.',
    components: [openControlRow()],
  });
  return true;
}

async function buildTranscript(channel) {
  const messages = [];
  let before;

  while (messages.length < MAX_TRANSCRIPT_MESSAGES) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;
    messages.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }

  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const lines = [
    `Ticket transcript: #${channel.name}`,
    `Channel ID: ${channel.id}`,
    `Generated: ${new Date().toISOString()}`,
    '',
  ];

  for (const message of messages) {
    const content = message.content?.replace(/\r?\n/g, '\\n') || '[no text content]';
    const attachments = [...message.attachments.values()].map(file => file.url).join(' ');
    lines.push(`[${new Date(message.createdTimestamp).toISOString()}] ${message.author?.tag || message.author?.id || 'unknown'}: ${content}${attachments ? ` | Attachments: ${attachments}` : ''}`);
  }

  return lines.join('\n');
}

async function sendTranscript(channel, interaction) {
  try {
    const transcript = await buildTranscript(channel);
    const attachment = new AttachmentBuilder(Buffer.from(transcript, 'utf8'), { name: `transcript-${channel.id}.txt` });
    const settings = await getSettings(interaction.guildId);
    const logChannel = settings.log_channel_id ? interaction.guild.channels.cache.get(settings.log_channel_id) : null;
    if (logChannel?.isTextBased()) {
      await logChannel.send({ content: `📄 Transcript for **#${channel.name}**`, files: [attachment] });
      return true;
    }
  } catch (error) {
    console.error('[Tickets] Failed to generate/send transcript:', error);
  }
  return false;
}

async function deleteTicket(interaction) {
  if (!isTicketChannel(interaction.channel)) return false;
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({ content: '❌ You need Manage Channels to delete tickets.', ephemeral: true });
    return true;
  }

  await sendTranscript(interaction.channel, interaction);
  await interaction.reply({ content: '🗑️ Transcript saved when a log channel is configured. Deleting ticket…' });
  await query('DELETE FROM tickets WHERE channel_id = $1', [interaction.channel.id]).catch(error => console.error('[Tickets] Failed to remove ticket record:', error));
  setTimeout(() => interaction.channel.delete('Ticket deleted').catch(() => null), 750);
  return true;
}

async function handleTicketButton(interaction) {
  if (!interaction.isButton()) return false;
  if (interaction.customId === 'ticket_open') return openTicket(interaction);
  if (interaction.customId === 'ticket_claim') return claimTicket(interaction);
  if (interaction.customId === 'ticket_close') return closeTicket(interaction);
  if (interaction.customId === 'ticket_reopen') return reopenTicket(interaction);
  if (interaction.customId === 'ticket_delete') return deleteTicket(interaction);
  return false;
}

module.exports = { setupTicketPanel, handleTicketButton, isTicketChannel };
