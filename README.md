# The Bot Father

A modular Discord moderation and community bot built with Node.js and discord.js.

## V1

- Slash-command moderation
- Persistent warnings
- Giveaways with buttons and restart recovery
- Moderation/event logging
- Utility commands
- Render/PostgreSQL deployment support

## Environment variables

- `DISCORD_TOKEN` — Discord bot token
- `CLIENT_ID` — Discord application/client ID
- `GUILD_ID` — optional development guild ID for fast command registration
- `DATABASE_URL` — PostgreSQL connection string
- `LOG_CHANNEL_ID` — optional channel ID for bot logs
- `PORT` — Render-provided web port

Never commit secrets or real tokens to this repository.
