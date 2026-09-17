require('dotenv').config();

const express = require('express');
const {
  Client,
  Collection,
  GatewayIntentBits,
  REST,
  Routes,
} = require('discord.js');
const { initDatabase, closeDatabase } = require('./database/database');
const moderation = require('./commands/moderation');
const utility = require('./commands/utility');
const { command: giveaway, handleGiveawayButton, restoreGiveaways } = require('./commands/giveaways');
const { command: settings } = require('./commands/config');
const { handleMessage } = require('./services/automod');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN) {
  console.error('[Startup] DISCORD_TOKEN is missing.');
  process.exit(1);
}
if (!CLIENT_ID) {
  console.error('[Startup] CLIENT_ID is missing.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.commands = new Collection();
const commandModules = [...moderation, ...utility, giveaway, settings];
for (const command of commandModules) client.commands.set(command.data.name, command);

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function registerCommands() {
  const payload = commandModules.map(command => command.data.toJSON());
  if (process.env.GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, process.env.GUILD_ID), { body: payload });
    console.log(`[Commands] Registered ${payload.length} command(s) to development guild.`);
  } else {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: payload });
    console.log(`[Commands] Registered ${payload.length} global command(s).`);
  }
}

client.once('ready', async readyClient => {
  console.log(`[Discord] Logged in as ${readyClient.user.tag}`);
  try {
    await restoreGiveaways(client);
  } catch (error) {
    console.error('[Giveaways] Could not restore giveaways:', error.message);
  }
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isButton()) {
      await handleGiveawayButton(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    await command.execute(interaction);
  } catch (error) {
    console.error(`[Interaction] ${interaction.commandName || interaction.customId}:`, error);
    const response = { content: '❌ Something went wrong while processing that request.', ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(response).catch(() => null);
    else await interaction.reply(response).catch(() => null);
  }
});

client.on('messageCreate', async message => {
  try {
    await handleMessage(message);
  } catch (error) {
    console.error('[AutoMod] Message handler error:', error);
  }
});

client.on('guildMemberAdd', member => {
  const channelId = process.env.LOG_CHANNEL_ID;
  if (!channelId) return;
  const channel = member.guild.channels.cache.get(channelId);
  channel?.send(`📥 **${member.user.tag}** joined the server.`).catch(() => null);
});

client.on('guildMemberRemove', member => {
  const channelId = process.env.LOG_CHANNEL_ID;
  if (!channelId) return;
  const channel = member.guild.channels.cache.get(channelId);
  channel?.send(`📤 **${member.user.tag}** left the server.`).catch(() => null);
});

const app = express();
app.disable('x-powered-by');
app.get('/', (_req, res) => res.json({ name: 'The Bot Father', status: client.isReady() ? 'online' : 'starting' }));
const healthCheck = (_req, res) => res.status(client.isReady() ? 200 : 503).json({ status: client.isReady() ? 'ok' : 'starting' });
app.get('/health', healthCheck);
app.head('/health', healthCheck);

const port = Number(process.env.PORT) || 3000;
const server = app.listen(port, '0.0.0.0', () => console.log(`[Web] Health server listening on ${port}`));

async function shutdown(signal) {
  console.log(`[Shutdown] Received ${signal}.`);
  server.close();
  client.destroy();
  await closeDatabase().catch(() => null);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

(async () => {
  try {
    await initDatabase();
    await registerCommands();
    await client.login(TOKEN);
  } catch (error) {
    console.error('[Startup] Fatal error:', error);
    await closeDatabase().catch(() => null);
    process.exit(1);
  }
})();
