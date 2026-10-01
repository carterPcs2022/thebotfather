const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

const commands = [
  { data: new SlashCommandBuilder().setName('ping').setDescription('Check the bot latency.'), async execute(i){ await i.reply('Pong! ' + i.client.ws.ping + 'ms'); } },
  { data: new SlashCommandBuilder().setName('help').setDescription('Show The Bot Father command categories.'), async execute(i){
    const e=new EmbedBuilder().setTitle('The Bot Father').setDescription('Discord server management toolkit.').addFields(
      {name:'Moderation',value:'`/ban` `/kick` `/timeout` `/untimeout` `/warn` `/warnings` `/unwarn` `/clear` `/unban` `/softban` `/purge` `/slowmode` `/lock` `/unlock` `/nick` `/modlogs` `/modcase`'},
      {name:'Community',value:'`/rank` `/leaderboard` `/rep` `/repleaderboard` `/daily` `/poll` `/suggestion`'},
      {name:'Server',value:'`/settings` `/verify` `/ticket` `/giveaway` `/schedule` `/rolepanel`'},
      {name:'Utility',value:'`/serverinfo` `/userinfo` `/avatar` `/botinfo` `/roleinfo` `/channelinfo` `/membercount` `/servericon` `/serverbanner` `/timestamp` `/role`'},
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
  {
    data: new SlashCommandBuilder()
      .setName('role')
      .setDescription('Manage server roles.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .addSubcommand(s => s.setName('create').setDescription('Create a new server role.')
        .addStringOption(o => o.setName('name').setDescription('Role name.').setMaxLength(100).setRequired(true))
        .addStringOption(o => o.setName('color').setDescription('Hex color, e.g. #5865F2.').setMaxLength(7))
        .addBooleanOption(o => o.setName('hoist').setDescription('Display separately in the member list.'))
        .addBooleanOption(o => o.setName('mentionable').setDescription('Allow members to mention the role.')))
      .addSubcommand(s => s.setName('delete').setDescription('Delete a role.')
        .addRoleOption(o => o.setName('role').setDescription('Role to delete.').setRequired(true)))
      .addSubcommand(s => s.setName('edit').setDescription('Edit a role.')
        .addRoleOption(o => o.setName('role').setDescription('Role to edit.').setRequired(true))
        .addStringOption(o => o.setName('name').setDescription('New role name.').setMaxLength(100))
        .addStringOption(o => o.setName('color').setDescription('New hex color.').setMaxLength(7))
        .addBooleanOption(o => o.setName('hoist').setDescription('Display separately in the member list.'))
        .addBooleanOption(o => o.setName('mentionable').setDescription('Allow members to mention the role.')))
      .addSubcommand(s => s.setName('add').setDescription('Give a role to a member.')
        .addUserOption(o => o.setName('user').setDescription('Member.').setRequired(true))
        .addRoleOption(o => o.setName('role').setDescription('Role to give.').setRequired(true)))
      .addSubcommand(s => s.setName('remove').setDescription('Remove a role from a member.')
        .addUserOption(o => o.setName('user').setDescription('Member.').setRequired(true))
        .addRoleOption(o => o.setName('role').setDescription('Role to remove.').setRequired(true)))
      .addSubcommand(s => s.setName('list').setDescription('List server roles.')),
    async execute(i) {
      if (!i.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
        return i.reply({ content: '❌ You need Manage Roles.', ephemeral: true });
      }
      await i.deferReply({ ephemeral: true });
      const sub = i.options.getSubcommand();

      const rejectRole = role => {
        if (!role) return '❌ Role not found.';
        if (role.id === i.guild.id) return '❌ The @everyone role cannot be managed this way.';
        if (role.managed) return '❌ That role is managed by Discord/integration and cannot be changed.';
        if (!role.editable) return '❌ I cannot manage that role. Move it below The Bot Father role.';
        if (i.member.roles.highest.position <= role.position) return '❌ You can only manage roles below your highest role.';
        return null;
      };
      const validateColor = color => !color || /^#[0-9a-fA-F]{6}$/.test(color);

      try {
        if (sub === 'create') {
          const name = i.options.getString('name', true).trim();
          const color = i.options.getString('color')?.trim();
          const hoist = i.options.getBoolean('hoist') ?? false;
          const mentionable = i.options.getBoolean('mentionable') ?? false;
          if (color && !validateColor(color)) return i.editReply('❌ Color must look like #5865F2.');
          if (!i.guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) return i.editReply('❌ I need Manage Roles permission.');
          const role = await i.guild.roles.create({ name, color: color || undefined, hoist, mentionable, reason: 'Created by ' + i.user.tag });
          return i.editReply('✅ Created ' + role.toString() + ' — ' + name + '.');
        }

        const role = i.options.getRole('role');
        const error = rejectRole(role);
        if (error) return i.editReply(error);

        if (sub === 'delete') {
          await role.delete('Deleted by ' + i.user.tag);
          return i.editReply('🗑️ Deleted **' + role.name + '**.');
        }

        if (sub === 'edit') {
          const name = i.options.getString('name')?.trim();
          const color = i.options.getString('color')?.trim();
          const hoist = i.options.getBoolean('hoist');
          const mentionable = i.options.getBoolean('mentionable');
          if (!name && !color && hoist === null && mentionable === null) return i.editReply('❌ Provide at least one property to change.');
          if (color && !validateColor(color)) return i.editReply('❌ Color must look like #5865F2.');
          const changes = {};
          if (name) changes.name = name;
          if (color) changes.color = color;
          if (hoist !== null) changes.hoist = hoist;
          if (mentionable !== null) changes.mentionable = mentionable;
          await role.edit({ ...changes, reason: 'Edited by ' + i.user.tag });
          return i.editReply('✅ Updated ' + role.toString() + '.');
        }

        if (sub === 'add' || sub === 'remove') {
          const user = i.options.getUser('user', true);
          const member = await i.guild.members.fetch(user.id).catch(() => null);
          if (!member) return i.editReply('❌ That user is not in this server.');
          if (sub === 'add') {
            await member.roles.add(role, 'Added by ' + i.user.tag);
            return i.editReply('✅ Added ' + role.toString() + ' to <@' + user.id + '>.');
          }
          await member.roles.remove(role, 'Removed by ' + i.user.tag);
          return i.editReply('✅ Removed ' + role.toString() + ' from <@' + user.id + '>.');
        }

        const roles = i.guild.roles.cache
          .filter(r => r.id !== i.guild.id)
          .sort((a, b) => b.position - a.position)
          .first(25);
        if (!roles.length) return i.editReply('No server roles found.');
        return i.editReply(roles.map(r => r.toString() + ' — `' + r.id + '`').join('\n'));
      } catch (error) {
        console.error('[Role] Failed:', error);
        return i.editReply('❌ Role action failed. Discord said: ' + (error.message || 'unknown error')).catch(() => null);
      }
    },
  },
];
module.exports = commands;