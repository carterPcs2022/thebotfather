const { EmbedBuilder } = require('discord.js');
const { query } = require('../database/database');

async function getLogChannel(guild) {
  const result = await query('SELECT log_channel_id FROM guild_settings WHERE guild_id=$1', [guild.id]).catch(() => ({ rows: [] }));
  const id = result.rows[0]?.log_channel_id || process.env.LOG_CHANNEL_ID;
  if (!id) return null;
  const channel = guild.channels.cache.get(id) || await guild.channels.fetch(id).catch(() => null);
  return channel?.isTextBased() ? channel : null;
}
async function logEvent(client,guild,title,description,fields=[]) {
  const channel=await getLogChannel(guild); if(!channel) return;
  const e=new EmbedBuilder().setTitle(title).setDescription(description||null).setTimestamp();
  if(fields.length)e.addFields(fields);
  await channel.send({embeds:[e]}).catch(()=>null);
}
async function logMemberEvent(client,member,title,description) {
  return logEvent(client,member.guild,title,description,[{name:'User',value:member.user.tag+' ('+member.id+')'}]);
}
async function logMessageEvent(message,title,description) {
  return logEvent(message.client,message.guild,title,description,[{name:'Channel',value:message.channel.toString()},{name:'User',value:message.author.tag+' ('+message.author.id+')'}]);
}
async function audit(guild,type,executorId,targetId,reason,metadata={}) {
  await query('INSERT INTO moderation_cases (guild_id,target_id,moderator_id,action,reason,metadata) VALUES ($1,$2,$3,$4,$5,$6::jsonb)', [guild.id,targetId,executorId,type,reason||'Audit event',JSON.stringify(metadata)]).catch(()=>null);
}
module.exports={logEvent,logMemberEvent,logMessageEvent,audit};