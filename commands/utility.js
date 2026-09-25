const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

const commands = [
  { data: new SlashCommandBuilder().setName('ping').setDescription('Check the bot latency.'), async execute(i){ await i.reply('Pong! ' + i.client.ws.ping + 'ms'); } },
  { data: new SlashCommandBuilder().setName('help').setDescription('Show The Bot Father command categories.'), async execute(i){
    const e=new EmbedBuilder().setTitle('The Bot Father').setDescription('Discord server management toolkit.').addFields(
      {name:'Moderation',value:'`/ban` `/kick` `/timeout` `/untimeout` `/warn` `/warnings` `/unwarn` `/modlogs` `/clear` `/unban` `/softban` `/purge` `/slowmode` `/lock` `/unlock` `/nick`'},
      {name:'Community',value:'`/rank` `/leaderboard` `/rep` `/repleaderboard` `/daily` `/poll` `/suggestion`'},
      {name:'Server',value:'`/settings` `/verify` `/ticket` `/giveaway`'},
      {name:'Utility',value:'`/serverinfo` `/userinfo` `/avatar` `/botinfo` `/roleinfo` `/channelinfo` `/membercount` `/servericon` `/serverbanner` `/timestamp` `/embed` `/say` `/afk`'});
    await i.reply({embeds:[e]}); } },
  { data:new SlashCommandBuilder().setName('serverinfo').setDescription('Show information about this server.'), async execute(i){ const g=i.guild; await i.reply({embeds:[new EmbedBuilder().setTitle(g.name).addFields({name:'Members',value:String(g.memberCount),inline:true},{name:'Channels',value:String(g.channels.cache.size),inline:true},{name:'Roles',value:String(g.roles.cache.size),inline:true},{name:'Server ID',value:g.id})]}); } },
  { data:new SlashCommandBuilder().setName('userinfo').setDescription('Show information about a user.').addUserOption(o=>o.setName('user').setDescription('User.')), async execute(i){ const u=i.options.getUser('user')||i.user; const m=await i.guild.members.fetch(u.id).catch(()=>null); await i.reply({embeds:[new EmbedBuilder().setTitle(u.tag).setThumbnail(u.displayAvatarURL({size:256})).addFields({name:'User ID',value:u.id},{name:'Created',value:'<t:'+Math.floor(u.createdTimestamp/1000)+':F>'},{name:'Joined',value:m?.joinedTimestamp?'<t:'+Math.floor(m.joinedTimestamp/1000)+':F>':'Unknown'},{name:'Bot',value:u.bot?'Yes':'No'})]}); } },
  { data:new SlashCommandBuilder().setName('avatar').setDescription('Show a user avatar.').addUserOption(o=>o.setName('user').setDescription('User.')), async execute(i){ const u=i.options.getUser('user')||i.user; await i.reply(u.displayAvatarURL({size:1024,extension:'png'})); } },
  { data:new SlashCommandBuilder().setName('botinfo').setDescription('Show bot status and technical information.'), async execute(i){ const e=new EmbedBuilder().setTitle('🤖 The Bot Father').addFields({name:'Status',value:i.client.isReady()?'Online':'Starting',inline:true},{name:'Ping',value:i.client.ws.ping+'ms',inline:true},{name:'Servers',value:String(i.client.guilds.cache.size),inline:true},{name:'Node.js',value:process.version,inline:true},{name:'Uptime',value:Math.floor(process.uptime()/60)+' minutes',inline:true}); await i.reply({embeds:[e]}); } },
  { data:new SlashCommandBuilder().setName('membercount').setDescription('Show server member counts.'), async execute(i){ await i.reply('👥 This server has **'+i.guild.memberCount+'** members.'); } },
  { data:new SlashCommandBuilder().setName('roleinfo').setDescription('Show information about a role.').addRoleOption(o=>o.setName('role').setDescription('Role.').setRequired(true)), async execute(i){ const r=i.options.getRole('role'); await i.reply({embeds:[new EmbedBuilder().setTitle('Role Information').addFields({name:'Role',value:r.toString(),inline:true},{name:'ID',value:r.id,inline:true},{name:'Position',value:String(r.position),inline:true},{name:'Members',value:String(r.members.size),inline:true})]}); } },
  { data:new SlashCommandBuilder().setName('channelinfo').setDescription('Show information about a channel.').addChannelOption(o=>o.setName('channel').setDescription('Channel.')), async execute(i){ const c=i.options.getChannel('channel')||i.channel; await i.reply({embeds:[new EmbedBuilder().setTitle('Channel Information').addFields({name:'Channel',value:c.toString(),inline:true},{name:'ID',value:c.id,inline:true},{name:'Type',value:String(c.type),inline:true},{name:'Created',value:'<t:'+Math.floor(c.createdTimestamp/1000)+':F>'})]}); } },
  { data:new SlashCommandBuilder().setName('servericon').setDescription('Show the server icon.'), async execute(i){ const u=i.guild.iconURL({size:1024}); await i.reply(u||'This server has no icon.'); } },
  { data:new SlashCommandBuilder().setName('serverbanner').setDescription('Show the server banner.'), async execute(i){ const u=i.guild.bannerURL({size:1024}); await i.reply(u||'This server has no banner.'); } },
  { data:new SlashCommandBuilder().setName('timestamp').setDescription('Convert a Unix timestamp into Discord timestamp formats.').addIntegerOption(o=>o.setName('unix').setDescription('Unix timestamp in seconds.').setRequired(true)), async execute(i){ const t=i.options.getInteger('unix'); await i.reply('Discord timestamp: `<t:'+t+':F>`\nRelative: `<t:'+t+':R>`'); } },
  { data:new SlashCommandBuilder().setName('embed').setDescription('Create a simple embed.').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages).addStringOption(o=>o.setName('title').setDescription('Title.').setRequired(true)).addStringOption(o=>o.setName('description').setDescription('Description.').setRequired(true)), async execute(i){ const e=new EmbedBuilder().setTitle(i.options.getString('title')).setDescription(i.options.getString('description')); await i.reply({embeds:[e]}); } },
  { data:new SlashCommandBuilder().setName('say').setDescription('Send a message as the bot.').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages).addStringOption(o=>o.setName('message').setDescription('Message.').setMaxLength(2000).setRequired(true)), async execute(i){
    const message = i.options.getString('message', true);
    try {
      await i.channel.send({ content: message, allowedMentions: { parse: [] } });
      await i.reply({ content: '✅ Sent.', ephemeral: true });
    } catch (error) {
      console.error('[Say] Failed to send message:', error);
      const response = { content: '❌ I could not send that message here. Make sure The Bot Father has **Send Messages** permission in this channel.', ephemeral: true };
      if (i.replied || i.deferred) await i.followUp(response).catch(() => null);
      else await i.reply(response).catch(() => null);
    }
  } },
];
module.exports = commands;