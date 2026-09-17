const { EmbedBuilder } = require('discord.js');

async function logEvent(client, guild, title, description, fields = []) {
  const channelId = process.env.LOG_CHANNEL_ID;
  if (!channelId || !guild) return;

  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description || null)
    .setTimestamp();

  if (fields.length) embed.addFields(fields);
  await channel.send({ embeds: [embed] }).catch(() => null);
}

module.exports = { logEvent };
