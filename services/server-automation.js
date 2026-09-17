const { query } = require('../database/database');
const { normalizeSettings } = require('../utils/config');

async function getSettings(guildId) {
  const result = await query('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId]);
  return normalizeSettings(result.rows[0]);
}

async function handleMemberJoin(member) {
  let settings;
  try { settings = await getSettings(member.guild.id); }
  catch (error) { console.error('[Automation] Could not load settings:', error.message); return; }

  if (settings.autorole_id) {
    const role = member.guild.roles.cache.get(settings.autorole_id);
    if (role && role.editable) {
      await member.roles.add(role, 'The Bot Father autorole').catch(error => {
        console.error('[Automation] Autorole failed:', error.message);
      });
    }
  }

  if (settings.welcome_enabled && settings.welcome_channel_id) {
    const channel = member.guild.channels.cache.get(settings.welcome_channel_id);
    if (channel?.isTextBased()) {
      await channel.send(`👋 Welcome <@${member.id}> to **${member.guild.name}**! You are member **#${member.guild.memberCount}**.`).catch(() => null);
    }
  }

  if (settings.welcome_dm_enabled) {
    await member.send(`Welcome to ${member.guild.name}! 🎉 Thanks for joining.`).catch(() => null);
  }
}

async function handleMemberLeave(member) {
  let settings;
  try { settings = await getSettings(member.guild.id); }
  catch (error) { console.error('[Automation] Could not load settings:', error.message); return; }

  if (settings.goodbye_enabled && settings.goodbye_channel_id) {
    const channel = member.guild.channels.cache.get(settings.goodbye_channel_id);
    if (channel?.isTextBased()) {
      await channel.send(`📤 **${member.user.tag}** left **${member.guild.name}**. We now have **${member.guild.memberCount}** members.`).catch(() => null);
    }
  }
}

async function verifyMember(interaction) {
  const settings = await getSettings(interaction.guildId);
  if (!settings.verification_enabled || !settings.verification_role_id) {
    return { ok: false, message: 'Verification is not configured in this server.' };
  }

  const role = interaction.guild.roles.cache.get(settings.verification_role_id);
  if (!role || !role.editable) {
    return { ok: false, message: 'The verification role is missing or below my highest role.' };
  }

  if (interaction.member.roles.cache.has(role.id)) {
    return { ok: true, message: 'You are already verified. ✅' };
  }

  await interaction.member.roles.add(role, 'The Bot Father verification');
  return { ok: true, message: 'You are verified! Welcome to the server. ✅' };
}

module.exports = { handleMemberJoin, handleMemberLeave, verifyMember };
