const { query } = require('../database/database');

async function handleAfkMessage(message) {
  if (!message.guild || message.author?.bot) return;

  const own = await query(
    'SELECT reason FROM afk_status WHERE guild_id = $1 AND user_id = $2',
    [message.guild.id, message.author.id]
  );

  if (own.rows.length) {
    await query(
      'DELETE FROM afk_status WHERE guild_id = $1 AND user_id = $2',
      [message.guild.id, message.author.id]
    );

    await message.channel.send(
      \`👋 Welcome back, <@\${message.author.id}>! Your AFK status has been removed.\`
    );
  }

  const mentionedIds = [...message.mentions.users.keys()].filter(id => id !== message.author.id);
  if (!mentionedIds.length) return;

  const result = await query(
    'SELECT user_id, reason FROM afk_status WHERE guild_id = $1 AND user_id = ANY($2::text[])',
    [message.guild.id, mentionedIds]
  );

  for (const row of result.rows) {
    await message.channel.send(
      \`💤 <@\${row.user_id}> is currently AFK — \${row.reason}\`
    );
  }
}

module.exports = { handleAfkMessage };
