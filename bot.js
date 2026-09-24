require('dotenv').config();

const express = require('express');
const { dashboard } = require('./utils/dashboard');
const {
  Client, Collection, GatewayIntentBits, REST, Routes,
} = require('discord.js');
const { initDatabase, closeDatabase } = require('./database/database');
const moderation = require('./commands/moderation');
const advancedModeration = require('./commands/advanced-moderation');
const utility = require('./commands/utility');
const { command: giveaway, handleGiveawayButton, restoreGiveaways } = require('./commands/giveaways');
const { command: settings } = require('./commands/config');
const { command: verification, handleVerificationButton } = require('./commands/verification');
const { command: ticket } = require('./commands/tickets');
const { command: poll, handlePollButton, restorePolls } = require('./commands/polls');
const { command: suggestion, handleSuggestionButton } = require('./commands/suggestions');
const { handleTicketButton } = require('./services/tickets');
const { handleMessage } = require('./services/automod');
const { handleMemberJoin, handleMemberLeave } = require('./services/server-automation');
const { handleAfkMessage } = require('./services/afk');
const { awardMessageXp, startLevelCleanup } = require('./services/levels');
const { logEvent, logMemberEvent, logMessageEvent } = require('./utils/logging');
const { command: rank, leaderboardCommand } = require('./commands/levels');
const { rep, daily, repLeaderboardCommand } = require('./commands/community');
const { command: afk } = require('./commands/afk');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN) { console.error('[Startup] DISCORD_TOKEN is missing.'); process.exit(1); }
if (!CLIENT_ID) { console.error('[Startup] CLIENT_ID is missing.'); process.exit(1); }

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.commands = new Collection();
const commandModules = [...moderation, ...advancedModeration, ...utility, giveaway, settings, verification, ticket, poll, suggestion, rank, leaderboardCommand, rep, daily, repLeaderboardCommand, afk];
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
  startLevelCleanup();
  try { await restoreGiveaways(client); } catch (error) { console.error('[Giveaways] Could not restore giveaways:', error.message); }
  try { await restorePolls(client); } catch (error) { console.error('[Polls] Could not restore polls:', error.message); }
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isButton()) {
      if (await handleVerificationButton(interaction)) return;
      if (await handleTicketButton(interaction)) return;
      if (await handleGiveawayButton(interaction)) return;
      if (await handlePollButton(interaction)) return;
      if (await handleSuggestionButton(interaction)) return;
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
  try { await handleAfkMessage(message); } catch (error) { console.error('[AFK] Handler error:', error); }
  try { await handleMessage(message); } catch (error) { console.error('[AutoMod] Handler error:', error); }
  try { await awardMessageXp(message); } catch (error) { console.error('[Levels] Handler error:', error); }
});

client.on('messageDelete', async message => {
  if (!message.guild || message.author?.bot) return;
  await logMessageEvent(message, 'Message deleted', 'A message was deleted.');
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (!newMessage.guild || newMessage.author?.bot || oldMessage.content === newMessage.content) return;
  await logMessageEvent(newMessage, 'Message edited', 'A message was edited.');
});

client.on('guildMemberAdd', async member => {
  await logMemberEvent(client, member, 'Member joined', `${member.user.tag} joined the server.`);
  await handleMemberJoin(member);
});

client.on('guildMemberRemove', async member => {
  await logMemberEvent(client, member, 'Member left', `${member.user.tag} left the server.`);
  await handleMemberLeave(member);
});

const app = express();
app.use(express.json({ limit: '32kb' }));
dashboard(app, client);
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
